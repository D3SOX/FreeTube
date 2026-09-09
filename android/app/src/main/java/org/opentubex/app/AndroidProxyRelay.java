package org.opentubex.app;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.IDN;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** One HTTP proxy for Chromium, URLConnection, Media3 and child processes.
 * Upstream connections never fall back to direct, including failed handshakes.
 */
final class AndroidProxyRelay implements AutoCloseable {
    private static final int TIMEOUT = 30_000;
    private final ServerSocket server;
    private final ExecutorService threads = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "opentubex-proxy");
        thread.setDaemon(true);
        return thread;
    });
    private final Semaphore capacity = new Semaphore(64);
    private final Set<Socket> sockets = new HashSet<>();
    private final ProxySelector systemSelector;
    private ProxyConfiguration configuration;
    private long generation;

    AndroidProxyRelay(ProxyConfiguration configuration, ProxySelector systemSelector) throws IOException {
        this.configuration = configuration;
        this.systemSelector = systemSelector;
        server = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        threads.execute(this::accept);
    }

    int port() { return server.getLocalPort(); }
    String url() { return "http://127.0.0.1:" + port(); }

    synchronized void configure(ProxyConfiguration value) {
        if (configuration.equals(value)) return;
        configuration = value;
        generation++;
        for (Socket socket : sockets) closeSocket(socket);
        sockets.clear();
    }

    private void accept() {
        while (!server.isClosed()) {
            try {
                Socket client = server.accept();
                if (!capacity.tryAcquire()) { closeSocket(client); continue; }
                synchronized (this) { sockets.add(client); }
                threads.execute(() -> {
                    try { forward(client); } finally {
                        closeSocket(client);
                        synchronized (this) { sockets.remove(client); }
                        capacity.release();
                    }
                });
            } catch (IOException error) {
                if (!server.isClosed()) close();
            }
        }
    }

    private void forward(Socket client) {
        Socket upstream = null;
        Socket transport = null;
        boolean connected = false;
        try {
            final ProxyConfiguration policy;
            final long version;
            synchronized (this) { policy = configuration; version = generation; }
            policy.validate();
            client.setSoTimeout(TIMEOUT);
            String[] headers = readHeaders(client.getInputStream()).split("\r\n");
            String[] request = headers[0].split(" ", 3);
            if (request.length != 3) throw new IOException("Invalid proxy request");
            boolean tunnel = request[0].equals("CONNECT");
            URI target = new URI(tunnel ? "https://" + request[1] : request[1]);
            if ((!tunnel && !"http".equals(target.getScheme())) || target.getHost() == null ||
                target.getRawUserInfo() != null) throw new IOException("Invalid proxy target");
            int port = target.getPort() == -1 ? (tunnel ? 443 : 80) : target.getPort();
            if (port < 1 || port > 65535) throw new IOException("Invalid destination port");
            String host = target.getHost().replace("[", "").replace("]", "");
            upstream = new Socket(Proxy.NO_PROXY);
            transport = upstream;
            synchronized (this) {
                if (version != generation || client.isClosed()) throw new IOException("Proxy changed");
                sockets.add(upstream);
            }
            ProxyConfiguration route = resolveSystemProxy(policy, target);
            boolean forwardHttp = !tunnel && route.enabled && Arrays.asList("http", "https").contains(route.protocol);
            upstream = connect(upstream, route, host, port, forwardHttp);
            final Socket remote = upstream;
            synchronized (this) {
                if (version != generation || client.isClosed()) throw new IOException("Proxy changed");
            }
            OutputStream output = remote.getOutputStream();
            if (tunnel) {
                client.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            } else {
                String path = target.getRawPath();
                if (path == null || path.isEmpty()) path = "/";
                if (target.getRawQuery() != null) path += "?" + target.getRawQuery();
                StringBuilder forwarded = new StringBuilder(request[0] + " " +
                    (forwardHttp ? target.toASCIIString() : path) + " HTTP/1.1\r\n");
                for (int i = 1; i < headers.length; i++) {
                    String name = headers[i].split(":", 2)[0].toLowerCase(Locale.ROOT);
                    if (!Arrays.asList("proxy-authorization", "proxy-connection", "connection", "host").contains(name)) {
                        forwarded.append(headers[i]).append("\r\n");
                    }
                }
                forwarded.append("Host: ").append(authority(host, port)).append("\r\nConnection: close\r\n\r\n");
                if (forwardHttp) forwarded.insert(forwarded.length() - 2, authorization(route));
                output.write(forwarded.toString().getBytes(StandardCharsets.ISO_8859_1));
            }
            // Read timeouts bound the handshake only. A download can keep receiving
            // data without sending anything for much longer; the caller owns its
            // transfer timeout and closing either socket still cancels both pumps.
            client.setSoTimeout(0);
            remote.setSoTimeout(0);
            connected = true;
            // Half-close preserves responses after a client finishes sending its body.
            threads.execute(() -> copyRequest(client, remote));
            copy(remote.getInputStream(), client.getOutputStream());
        } catch (Exception error) {
            if (!connected) {
                try { client.getOutputStream().write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); }
                catch (IOException ignored) { /* Client has already disconnected. */ }
            }
        } finally {
            closeSocket(upstream);
            synchronized (this) { sockets.remove(transport); }
        }
    }

    static void copyRequest(Socket client, Socket remote) {
        try {
            copy(client.getInputStream(), remote.getOutputStream());
            try { remote.shutdownOutput(); }
            catch (UnsupportedOperationException ignored) {
                // Older Android TLS sockets cannot half-close. HTTP bodies and
                // tunneled TLS records carry their own completion markers; leave
                // the response pump running until the peer closes or we cancel.
            }
        } catch (IOException ignored) { closeSocket(remote); }
    }

    private ProxyConfiguration resolveSystemProxy(ProxyConfiguration policy, URI target) {
        if (!policy.enabled && systemSelector != null) {
            // Preserve Android's Wi-Fi proxy when the app proxy is disabled.
            for (Proxy proxy : systemSelector.select(target)) {
                if (proxy.type() == Proxy.Type.DIRECT) break;
                if (proxy.address() instanceof InetSocketAddress address) {
                    policy = new ProxyConfiguration(true, proxy.type() == Proxy.Type.HTTP ? "http" : "socks5",
                        address.getHostString(), Integer.toString(address.getPort()), "", "");
                    break;
                }
            }
        }
        return policy;
    }

    private Socket connect(Socket socket, ProxyConfiguration policy, String host, int port, boolean forwardHttp) throws IOException {
        String endpoint = policy.enabled ? policy.hostname : host;
        int endpointPort = policy.enabled ? policy.port : port;
        socket.connect(new InetSocketAddress(endpoint, endpointPort), TIMEOUT);
        socket.setSoTimeout(TIMEOUT);
        if (!policy.enabled) return socket;
        if (policy.protocol.equals("https")) {
            SSLSocket tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault())
                .createSocket(socket, endpoint, endpointPort, true);
            SSLParameters parameters = tls.getSSLParameters();
            parameters.setEndpointIdentificationAlgorithm("HTTPS");
            tls.setSSLParameters(parameters);
            tls.startHandshake();
            socket = tls;
        }
        InputStream input = socket.getInputStream();
        OutputStream output = socket.getOutputStream();
        if (forwardHttp) return socket;
        switch (policy.protocol) {
            case "http": case "https":
                String destination = authority(host, port);
                output.write(("CONNECT " + destination + " HTTP/1.1\r\nHost: " + destination + "\r\n" + authorization(policy) + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
                String[] status = readHeaders(input).split("\r\n", 2)[0].split(" ", 3);
                if (status.length < 2 || !status[1].equals("200")) throw new IOException("Proxy refused CONNECT");
                break;
            case "socks5":
                socks5(input, output, policy, host, port);
                break;
            case "socks4":
                // SOCKS4a resolves the destination remotely, unlike plain SOCKS4.
                output.write(new byte[] {4, 1, (byte) (port >> 8), (byte) port, 0, 0, 0, 1, 0});
                output.write(IDN.toASCII(host).getBytes(StandardCharsets.US_ASCII));
                output.write(0);
                byte[] reply = readBytes(input, 8);
                if (reply[1] != 90) throw new IOException("SOCKS4 proxy refused connection");
                break;
            default: throw new IOException("Unsupported proxy protocol");
        }
        return socket;
    }

    private static void socks5(InputStream input, OutputStream output, ProxyConfiguration policy,
                               String host, int port) throws IOException {
        boolean authenticate = !policy.username.isEmpty() || !policy.password.isEmpty();
        output.write(new byte[] {5, 1, (byte) (authenticate ? 2 : 0)});
        byte[] greeting = readBytes(input, 2);
        if (greeting[0] != 5 || greeting[1] != (authenticate ? 2 : 0)) throw new IOException("SOCKS5 authentication rejected");
        if (authenticate) {
            byte[] user = policy.username.getBytes(StandardCharsets.UTF_8);
            byte[] password = policy.password.getBytes(StandardCharsets.UTF_8);
            if (user.length > 255 || password.length > 255) throw new IOException("SOCKS5 credentials too long");
            output.write(1); output.write(user.length); output.write(user);
            output.write(password.length); output.write(password);
            byte[] auth = readBytes(input, 2);
            if (auth[0] != 1 || auth[1] != 0) throw new IOException("SOCKS5 authentication rejected");
        }
        output.write(new byte[] {5, 1, 0});
        if (host.contains(":")) {
            output.write(4);
            output.write(InetAddress.getByName(host).getAddress());
        } else {
            byte[] name = IDN.toASCII(host).getBytes(StandardCharsets.US_ASCII);
            if (name.length > 255) throw new IOException("Destination hostname too long");
            output.write(3); output.write(name.length); output.write(name);
        }
        output.write(port >> 8); output.write(port & 255);
        byte[] reply = readBytes(input, 4);
        if (reply[0] != 5 || reply[1] != 0 || reply[2] != 0) throw new IOException("SOCKS5 proxy refused connection");
        int length = switch (reply[3]) { case 1 -> 4; case 4 -> 16; case 3 -> readBytes(input, 1)[0] & 255;
            default -> throw new IOException("Invalid SOCKS5 address"); };
        readBytes(input, length + 2);
    }

    static String readHeaders(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int tail = 0;
        while (bytes.size() < 65536) {
            int next = input.read();
            if (next == -1) throw new EOFException();
            bytes.write(next);
            tail = (tail << 8) | next;
            if (tail == 0x0d0a0d0a) return bytes.toString(StandardCharsets.ISO_8859_1.name());
        }
        throw new IOException("Proxy headers too large");
    }

    private static byte[] readBytes(InputStream input, int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(bytes, offset, length - offset);
            if (count == -1) throw new EOFException();
            offset += count;
        }
        return bytes;
    }

    private static String authority(String host, int port) {
        return (host.contains(":") ? "[" + host + "]" : host) + ":" + port;
    }

    private static String authorization(ProxyConfiguration policy) {
        if (policy.username.isEmpty() && policy.password.isEmpty()) return "";
        return "Proxy-Authorization: Basic " + Base64.getEncoder().encodeToString(
            (policy.username + ":" + policy.password).getBytes(StandardCharsets.UTF_8)) + "\r\n";
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[32768];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    private static void closeSocket(Socket socket) {
        if (socket != null) try { socket.close(); } catch (IOException ignored) { /* Already closed. */ }
    }

    @Override public synchronized void close() {
        try { server.close(); } catch (IOException ignored) { /* Already closed. */ }
        for (Socket socket : sockets) closeSocket(socket);
        sockets.clear();
        threads.shutdownNow();
    }
}
