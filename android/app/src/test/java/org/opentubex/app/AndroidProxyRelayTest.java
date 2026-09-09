package org.opentubex.app;

import static org.junit.Assert.*;

import org.junit.Test;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public class AndroidProxyRelayTest {
    private static ProxyConfiguration policy(String protocol, int port, String user, String password) {
        return new ProxyConfiguration(true, protocol, "127.0.0.1", Integer.toString(port), user, password);
    }

    private static ServerSocket server() throws Exception {
        ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        socket.setSoTimeout(3000);
        return socket;
    }

    private static Socket connect(AndroidProxyRelay relay, String target) throws Exception {
        Socket client = new Socket("127.0.0.1", relay.port());
        client.setSoTimeout(3000);
        client.getOutputStream().write(("CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        return client;
    }

    @Test public void httpProxyReceivesRemoteHostnameAndCredentialsOnlyInHandshake() throws Exception {
        try (ServerSocket proxy = server(); AndroidProxyRelay relay = new AndroidProxyRelay(
            policy("http", proxy.getLocalPort(), "alice", "secret"), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    String headers = AndroidProxyRelay.readHeaders(socket.getInputStream());
                    assertTrue(headers.startsWith("CONNECT never-resolve.invalid:443 HTTP/1.1"));
                    assertTrue(headers.contains("Proxy-Authorization: Basic YWxpY2U6c2VjcmV0\r\n"));
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    assertEquals(42, socket.getInputStream().read());
                    socket.getOutputStream().write(43);
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket client = connect(relay, "never-resolve.invalid:443")) {
                assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
                client.getOutputStream().write(42);
                assertEquals(43, client.getInputStream().read());
            }
            upstream.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void socks5ResolvesRemotelyAndAuthenticates() throws Exception {
        try (ServerSocket proxy = server(); AndroidProxyRelay relay = new AndroidProxyRelay(
            policy("socks5", proxy.getLocalPort(), "alice", "secret"), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    InputStream input = socket.getInputStream();
                    OutputStream output = socket.getOutputStream();
                    assertArrayEquals(new byte[] {5, 1, 2}, input.readNBytes(3));
                    output.write(new byte[] {5, 2});
                    assertEquals(1, input.read());
                    assertEquals("alice", new String(input.readNBytes(input.read()), StandardCharsets.UTF_8));
                    assertEquals("secret", new String(input.readNBytes(input.read()), StandardCharsets.UTF_8));
                    output.write(new byte[] {1, 0});
                    assertArrayEquals(new byte[] {5, 1, 0, 3}, input.readNBytes(4));
                    assertEquals("never-resolve.invalid", new String(input.readNBytes(input.read()), StandardCharsets.US_ASCII));
                    assertArrayEquals(new byte[] {1, (byte) 187}, input.readNBytes(2));
                    output.write(new byte[] {5, 0, 0, 1, 0, 0, 0, 0, 0, 0});
                    output.write(42);
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket client = connect(relay, "never-resolve.invalid:443")) {
                assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
                assertEquals(42, client.getInputStream().read());
            }
            upstream.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void socks4UsesRemoteDnsExtension() throws Exception {
        try (ServerSocket proxy = server(); AndroidProxyRelay relay = new AndroidProxyRelay(
            policy("socks4", proxy.getLocalPort(), "", ""), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    assertArrayEquals(new byte[] {4, 1, 1, (byte) 187, 0, 0, 0, 1, 0}, socket.getInputStream().readNBytes(9));
                    assertEquals("never-resolve.invalid\0", new String(socket.getInputStream().readNBytes(22), StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(new byte[] {0, 90, 0, 0, 0, 0, 0, 0});
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket client = connect(relay, "never-resolve.invalid:443")) {
                assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
            }
            upstream.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void unreachableProxyAndInvalidSettingsNeverConnectDirectly() throws Exception {
        try (ServerSocket destination = server(); ServerSocket proxy = server()) {
            int closedPort = proxy.getLocalPort();
            proxy.close();
            for (String protocol : new String[] {"http", "https", "socks4", "socks5", "invalid"}) {
                try (AndroidProxyRelay relay = new AndroidProxyRelay(policy(protocol, closedPort, "", ""), null);
                     Socket client = connect(relay, "127.0.0.1:" + destination.getLocalPort())) {
                    assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 502"));
                }
            }
            destination.setSoTimeout(150);
            assertThrows(SocketTimeoutException.class, destination::accept);
        }
    }

    @Test public void rejectedAuthenticationDoesNotFallBack() throws Exception {
        try (ServerSocket proxy = server(); ServerSocket destination = server();
             AndroidProxyRelay relay = new AndroidProxyRelay(policy("http", proxy.getLocalPort(), "alice", "wrong"), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    AndroidProxyRelay.readHeaders(socket.getInputStream());
                    socket.getOutputStream().write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket client = connect(relay, "127.0.0.1:" + destination.getLocalPort())) {
                assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 502"));
            }
            upstream.get(5, TimeUnit.SECONDS);
            destination.setSoTimeout(150);
            assertThrows(SocketTimeoutException.class, destination::accept);
        }
    }

    @Test public void changingProxyClosesExistingDirectTunnel() throws Exception {
        try (ServerSocket destination = server();
             AndroidProxyRelay relay = new AndroidProxyRelay(new ProxyConfiguration(false, "", "", "", "", ""), null);
             Socket client = connect(relay, "127.0.0.1:" + destination.getLocalPort());
             Socket remote = destination.accept()) {
            assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
            relay.configure(policy("invalid", 1, "", ""));
            assertEquals(-1, client.getInputStream().read());
            remote.setSoTimeout(3000);
            assertEquals(-1, remote.getInputStream().read());
        }
    }

    @Test public void activeDownloadSurvivesThirtySecondsWithoutClientWrites() throws Exception {
        try (ServerSocket destination = server();
             AndroidProxyRelay relay = new AndroidProxyRelay(new ProxyConfiguration(false, "", "", "", "", ""), null);
             Socket client = connect(relay, "127.0.0.1:" + destination.getLocalPort());
             Socket remote = destination.accept()) {
            assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
            CompletableFuture<Void> download = CompletableFuture.runAsync(() -> {
                try {
                    for (int i = 0; i < 33; i++) {
                        remote.getOutputStream().write(i);
                        if (i < 32) Thread.sleep(1000);
                    }
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            for (int i = 0; i < 33; i++) {
                assertEquals("Download was interrupted at byte " + i, i, client.getInputStream().read());
            }
            download.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void reapplyingUnchangedSettingsKeepsBackgroundTunnelOpen() throws Exception {
        try (ServerSocket destination = server();
             AndroidProxyRelay relay = new AndroidProxyRelay(new ProxyConfiguration(false, "http", "localhost", "8080", "", ""), null);
             Socket client = connect(relay, "127.0.0.1:" + destination.getLocalPort());
             Socket remote = destination.accept()) {
            assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 200"));
            relay.configure(new ProxyConfiguration(false, "http", "localhost", "8080", "", ""));
            remote.getOutputStream().write(42);
            assertEquals(42, client.getInputStream().read());
        }
    }

    @Test public void plainHttpStreamsRequestAndResponseWithoutLeakingProxyAuthorization() throws Exception {
        try (ServerSocket destination = server();
             AndroidProxyRelay relay = new AndroidProxyRelay(new ProxyConfiguration(false, "", "", "", "", ""), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = destination.accept()) {
                    String headers = AndroidProxyRelay.readHeaders(socket.getInputStream());
                    assertTrue(headers.startsWith("POST /test?q=1 HTTP/1.1"));
                    assertFalse(headers.toLowerCase().contains("proxy-authorization"));
                    assertEquals("payload", new String(socket.getInputStream().readNBytes(7), StandardCharsets.US_ASCII));
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".getBytes(StandardCharsets.US_ASCII));
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + destination.getLocalPort() + "/test?q=1")
                .openConnection(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", relay.port())));
            connection.setReadTimeout(3000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Proxy-Authorization", "Basic should-not-leak");
            connection.getOutputStream().write("payload".getBytes(StandardCharsets.US_ASCII));
            assertEquals("ok", new String(connection.getInputStream().readAllBytes(), StandardCharsets.US_ASCII));
            connection.disconnect();
            upstream.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void plainHttpUsesAbsoluteFormAndProxyAuthenticationWithoutConnect() throws Exception {
        try (ServerSocket proxy = server(); AndroidProxyRelay relay = new AndroidProxyRelay(
            policy("http", proxy.getLocalPort(), "alice", "secret"), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    String headers = AndroidProxyRelay.readHeaders(socket.getInputStream());
                    assertTrue(headers, headers.startsWith("GET http://never-resolve.invalid/test?q=1 HTTP/1.1"));
                    assertTrue(headers.contains("Proxy-Authorization: Basic YWxpY2U6c2VjcmV0\r\n"));
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".getBytes(StandardCharsets.US_ASCII));
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            HttpURLConnection connection = (HttpURLConnection) new URL("http://never-resolve.invalid/test?q=1")
                .openConnection(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", relay.port())));
            connection.setReadTimeout(3000);
            assertEquals("ok", new String(connection.getInputStream().readAllBytes(), StandardCharsets.US_ASCII));
            connection.disconnect();
            upstream.get(5, TimeUnit.SECONDS);
        }
    }

    @Test public void httpsProxyRequiresTlsBeforeSendingCredentials() throws Exception {
        try (ServerSocket proxy = server(); AndroidProxyRelay relay = new AndroidProxyRelay(
            policy("https", proxy.getLocalPort(), "alice", "secret"), null)) {
            CompletableFuture<Void> upstream = CompletableFuture.runAsync(() -> {
                try (Socket socket = proxy.accept()) {
                    // TLS handshake record, never a plaintext CONNECT with credentials.
                    assertEquals(22, socket.getInputStream().read());
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket client = connect(relay, "never-resolve.invalid:443")) {
                assertTrue(AndroidProxyRelay.readHeaders(client.getInputStream()).startsWith("HTTP/1.1 502"));
            }
            upstream.get(5, TimeUnit.SECONDS);
        }
    }
}
