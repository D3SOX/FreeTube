package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Proxy;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import android.net.Uri;
import org.json.JSONObject;
import org.junit.Test;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class AndroidProxyIntegrationTest {
    private static final String TARGET = "https://never-resolve.invalid/proxy-test";

    /** Reject CONNECT after recording it, so no real external server or trusted test CA is needed. */
    private static final class RecordingProxy implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final CountDownLatch contacted = new CountDownLatch(1);
        volatile String request = "";
        RecordingProxy() throws Exception { this("never-resolve.invalid:443"); }
        RecordingProxy(String authority) throws Exception {
            Thread thread = new Thread(() -> {
                while (!server.isClosed()) {
                    try (Socket socket = server.accept()) {
                        String received = AndroidProxyRelay.readHeaders(socket.getInputStream());
                        // Ignore unrelated WebView requests such as the base page's favicon.
                        if (received.startsWith("CONNECT " + authority + " ")) {
                            request = received;
                            contacted.countDown();
                        }
                        socket.getOutputStream().write("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    } catch (Exception ignored) { return; }
                }
            }, "test-proxy");
            thread.setDaemon(true);
            thread.start();
        }
        void configure() throws Exception {
            AndroidProxy.configure(new JSONObject().put("enabled", true).put("protocol", "http")
                .put("hostname", "127.0.0.1").put("port", Integer.toString(server.getLocalPort()))
                .put("username", "alice").put("password", "secret"));
        }
        void assertContacted() throws Exception {
            assertTrue("Request did not reach the configured proxy", contacted.await(10, TimeUnit.SECONDS));
            assertTrue(request, request.startsWith("CONNECT never-resolve.invalid:443 "));
            assertTrue(request, request.contains("Proxy-Authorization: Basic YWxpY2U6c2VjcmV0"));
        }
        @Override public void close() throws Exception {
            AndroidProxy.configure(new JSONObject().put("enabled", false));
            server.close();
        }
    }

    /** Test-only TLS origin and authenticated forwarding proxy. The .invalid host has no direct route. */
    private static final class ForwardingProxy implements AutoCloseable {
        static final String BASE = "https://never-resolve.invalid";
        static final String LOCAL = "/youtubei/v1/player";
        static final String INVIDIOUS = "/api/v1/channels/test-channel/videos";
        final byte[] media = asset("demo.webm");
        final byte[] certificatePem = asset("proxy-test-certificate.pem");
        final X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(certificatePem));
        final SSLContext tls = SSLContext.getInstance("TLS");
        final SSLServerSocket origin;
        final ServerSocket proxy = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final ExecutorService threads = Executors.newCachedThreadPool();
        final List<String> proxyRequests = new CopyOnWriteArrayList<>();
        final List<String> requests = new CopyOnWriteArrayList<>();
        final List<Socket> sockets = new CopyOnWriteArrayList<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        ForwardingProxy() throws Exception {
            // This public fixture key is packaged only in the instrumentation APK.
            String pem = new String(asset("proxy-test-private-key.pem"), StandardCharsets.US_ASCII)
                .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
            KeyStore keys = KeyStore.getInstance(KeyStore.getDefaultType());
            keys.load(null);
            keys.setKeyEntry("origin", KeyFactory.getInstance("RSA").generatePrivate(
                new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem))), new char[0],
                new java.security.cert.Certificate[] {certificate});
            KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            managers.init(keys, new char[0]);
            KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
            trust.load(null);
            trust.setCertificateEntry("origin", certificate);
            TrustManagerFactory trusted = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            trusted.init(trust);
            tls.init(managers.getKeyManagers(), trusted.getTrustManagers(), null);
            origin = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(
                0, 20, InetAddress.getByName("127.0.0.1"));
            accept(origin, this::respond);
            accept(proxy, this::forward);
        }

        static byte[] asset(String name) throws Exception {
            try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name)) {
                return YtDlpFiles.read(input, 1024 * 1024);
            }
        }

        interface Connection { void handle(Socket socket) throws Exception; }

        void accept(ServerSocket server, Connection connection) {
            threads.execute(() -> {
                while (!server.isClosed()) {
                    try {
                        Socket socket = server.accept();
                        socket.setSoTimeout(10000);
                        sockets.add(socket);
                        threads.execute(() -> {
                            try (socket) { connection.handle(socket); }
                            catch (Exception error) {
                                // Chromium may discard its first connection while asking the test client to trust the fixture.
                                if (!server.isClosed() && !(error instanceof java.io.EOFException) &&
                                    !(error instanceof javax.net.ssl.SSLException) && !(error instanceof java.net.SocketException)) {
                                    failure.compareAndSet(null, error);
                                }
                            }
                            finally { sockets.remove(socket); }
                        });
                    } catch (Exception error) {
                        if (!server.isClosed()) failure.compareAndSet(null, error);
                        return;
                    }
                }
            });
        }

        void configure() throws Exception {
            AndroidProxy.ready().get(10, TimeUnit.SECONDS);
            AndroidProxy.configure(new JSONObject().put("enabled", true).put("protocol", "http")
                .put("hostname", "127.0.0.1").put("port", Integer.toString(proxy.getLocalPort()))
                .put("username", "alice").put("password", "secret"));
        }

        void forward(Socket client) throws Exception {
            String request = AndroidProxyRelay.readHeaders(client.getInputStream());
            proxyRequests.add(request);
            String credentials = "Proxy-Authorization: Basic YWxpY2U6c2VjcmV0\r\n";
            if (!request.contains(credentials)) throw new IllegalStateException("Missing proxy authentication");
            if (request.startsWith("GET http://never-resolve.invalid/demo.webm ") ||
                request.startsWith("HEAD http://never-resolve.invalid/demo.webm ")) {
                // Also exercise HTTP absolute-form forwarding. Only this fixed fixture origin is reachable.
                try (Socket remote = tls.getSocketFactory().createSocket("127.0.0.1", origin.getLocalPort())) {
                    remote.setSoTimeout(10000);
                    remote.getOutputStream().write(request.replace("http://never-resolve.invalid", "")
                        .replace(credentials, "").getBytes(StandardCharsets.ISO_8859_1));
                    copy(remote.getInputStream(), client.getOutputStream());
                }
                return;
            }
            if (!request.startsWith("CONNECT never-resolve.invalid:443 ")) {
                throw new IllegalStateException("Unexpected proxy request: " + request);
            }
            try (Socket remote = new Socket(Proxy.NO_PROXY)) {
                remote.connect(new java.net.InetSocketAddress("127.0.0.1", origin.getLocalPort()), 3000);
                remote.setSoTimeout(10000);
                client.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                threads.execute(() -> {
                    try { copy(client.getInputStream(), remote.getOutputStream()); }
                    catch (Exception ignored) { /* Closing either peer ends the tunnel. */ }
                });
                copy(remote.getInputStream(), client.getOutputStream());
            }
        }

        void respond(Socket socket) throws Exception {
            String request = AndroidProxyRelay.readHeaders(socket.getInputStream());
            requests.add(request);
            String path = request.split(" ", 3)[1];
            byte[] body;
            String type;
            if (path.equals(LOCAL)) {
                body = "{\"playabilityStatus\":{\"status\":\"OK\"},\"videoDetails\":{\"videoId\":\"proxy-video\"}}".getBytes(StandardCharsets.UTF_8);
                type = "application/json";
            } else if (path.equals(INVIDIOUS)) {
                body = "[{\"videoId\":\"proxy-video\",\"title\":\"Proxy fixture\"}]".getBytes(StandardCharsets.UTF_8);
                type = "application/json";
            } else if (path.equals("/demo.webm")) {
                body = media;
                type = "video/webm";
            } else if (path.equals("/favicon.ico")) {
                body = new byte[0];
                type = "image/x-icon";
            } else {
                throw new IllegalStateException("Unexpected origin request: " + request);
            }
            socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: " + type +
                "\r\nContent-Length: " + body.length + "\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            if (!request.startsWith("HEAD ")) socket.getOutputStream().write(body);
        }

        static void copy(InputStream input, OutputStream output) throws Exception {
            byte[] bytes = new byte[8192];
            int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
        }

        void assertForwarded(String path) {
            assertNull("Fixture failed: " + failure.get(), failure.get());
            assertFalse("No request reached the proxy", proxyRequests.isEmpty());
            assertTrue("Origin did not receive " + path, requests.stream().anyMatch(request -> request.contains(" " + path + " ")));
            assertTrue("Proxy credentials reached the origin", requests.stream()
                .noneMatch(request -> request.toLowerCase(java.util.Locale.ROOT).contains("proxy-authorization:")));
        }

        @Override public void close() throws Exception {
            origin.close();
            proxy.close();
            AndroidProxy.configure(new JSONObject().put("enabled", false));
            for (Socket socket : sockets) socket.close();
            threads.shutdownNow();
            assertTrue("Fixture threads did not stop", threads.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    @Test public void failedProxyOverrideBlocksViewsWithoutRetainingThem() throws Exception {
        AndroidProxy.ready().get(10, TimeUnit.SECONDS);
        java.lang.reflect.Field field = AndroidProxy.class.getDeclaredField("waitingViews");
        field.setAccessible(true);
        List<?> waiting = (List<?>) field.get(null);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            int retained = waiting.size();
            AndroidProxy.ready().obtrudeException(new IllegalStateException("Proxy override unsupported"));
            try {
                for (int i = 0; i < 3; i++) {
                    WebView view = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
                    try {
                        AndroidProxy.protectWebView(view);
                        assertTrue("Failed proxy setup must block network loads", view.getSettings().getBlockNetworkLoads());
                    } finally { view.destroy(); }
                }
                assertEquals("Destroyed views must not be retained after proxy setup fails", retained, waiting.size());
            } finally {
                waiting.clear();
                AndroidProxy.ready().obtrudeValue(null);
            }
        });
    }

    @Test public void nativeHttpAndMedia3ReadSuccessfulResponsesThroughForwardingProxy() throws Exception {
        try (ForwardingProxy proxy = new ForwardingProxy()) {
            proxy.configure();
            for (String path : List.of(ForwardingProxy.LOCAL, ForwardingProxy.INVIDIOUS)) {
                HttpsURLConnection request = (HttpsURLConnection) new URL(ForwardingProxy.BASE + path).openConnection();
                request.setSSLSocketFactory(proxy.tls.getSocketFactory());
                request.setConnectTimeout(3000);
                request.setReadTimeout(3000);
                try {
                    assertEquals(200, request.getResponseCode());
                    String json = new String(YtDlpFiles.read(request.getInputStream(), 4096), StandardCharsets.UTF_8);
                    if (path.equals(ForwardingProxy.LOCAL)) {
                        assertEquals("OK", new JSONObject(json).getJSONObject("playabilityStatus").getString("status"));
                    } else {
                        assertEquals("proxy-video", new org.json.JSONArray(json).getJSONObject(0).getString("videoId"));
                    }
                    proxy.assertForwarded(path);
                } finally { request.disconnect(); }
            }
            SSLSocketFactory previous = HttpsURLConnection.getDefaultSSLSocketFactory();
            DefaultHttpDataSource source = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(3000).setReadTimeoutMs(3000).createDataSource();
            try {
                // Media3 creates its own URLConnection; restore the test-only trust immediately after reading.
                HttpsURLConnection.setDefaultSSLSocketFactory(proxy.tls.getSocketFactory());
                assertEquals(proxy.media.length, source.open(new DataSpec(Uri.parse(ForwardingProxy.BASE + "/demo.webm"))));
                ByteArrayOutputStream downloaded = new ByteArrayOutputStream();
                byte[] bytes = new byte[8192];
                int count;
                while ((count = source.read(bytes, 0, bytes.length)) != -1) downloaded.write(bytes, 0, count);
                assertArrayEquals(proxy.media, downloaded.toByteArray());
                proxy.assertForwarded("/demo.webm");
            } finally {
                source.close();
                HttpsURLConnection.setDefaultSSLSocketFactory(previous);
            }
        }
    }

    @Test public void webViewReadsApiAndMediaResponsesThroughForwardingProxy() throws Exception {
        try (ForwardingProxy proxy = new ForwardingProxy()) {
            proxy.configure();
            CountDownLatch completed = new CountDownLatch(1);
            AtomicReference<String> result = new AtomicReference<>();
            AtomicReference<WebView> view = new AtomicReference<>();
            byte[] certificate = proxy.certificate.getEncoded();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView web = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
                view.set(web);
                AndroidProxy.protectWebView(web);
                web.getSettings().setJavaScriptEnabled(true);
                web.setWebViewClient(new WebViewClient() {
                    @Override public void onReceivedSslError(WebView webView, SslErrorHandler handler, SslError error) {
                        byte[] received = SslCertificate.saveState(error.getCertificate()).getByteArray("x509-certificate");
                        if (error.getUrl().startsWith(ForwardingProxy.BASE + "/") && Arrays.equals(certificate, received)) handler.proceed();
                        else handler.cancel();
                    }
                });
                web.addJavascriptInterface(new Object() {
                    @android.webkit.JavascriptInterface public void complete(String value) {
                        result.set(value);
                        completed.countDown();
                    }
                }, "testResult");
                String script = "Promise.all([fetch('" + ForwardingProxy.BASE + ForwardingProxy.LOCAL + "').then(r=>r.json())," +
                    "fetch('" + ForwardingProxy.BASE + ForwardingProxy.INVIDIOUS + "').then(r=>r.json())," +
                    "fetch('" + ForwardingProxy.BASE + "/demo.webm').then(r=>r.arrayBuffer())])" +
                    ".then(([local,feed,media])=>testResult.complete(JSON.stringify({status:local.playabilityStatus.status," +
                    "videoId:feed[0].videoId,bytes:media.byteLength}))).catch(e=>testResult.complete(String(e)))";
                web.loadDataWithBaseURL(ForwardingProxy.BASE + "/", "<script>" + script + "</script>", "text/html", "UTF-8", null);
            });
            try {
                assertTrue("WebView fetch did not finish", completed.await(20, TimeUnit.SECONDS));
                JSONObject value = new JSONObject(result.get());
                assertEquals("OK", value.getString("status"));
                assertEquals("proxy-video", value.getString("videoId"));
                assertEquals(proxy.media.length, value.getInt("bytes"));
                for (String path : List.of(ForwardingProxy.LOCAL, ForwardingProxy.INVIDIOUS, "/demo.webm")) proxy.assertForwarded(path);
            } finally {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.get().destroy());
            }
        }
    }

    @Test public void ytDlpExtractsAndDownloadsThroughForwardingProxy() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "proxy-forwarding-test");
        directory.mkdirs();
        try (ForwardingProxy proxy = new ForwardingProxy()) {
            proxy.configure();
            String target = "http://never-resolve.invalid/demo.webm";
            JSONObject metadata = new JSONObject(YtDlpRuntime.extract(context, List.of(
                "--dump-single-json", "--skip-download", "--socket-timeout", "5", target)));
            assertEquals("webm", metadata.getString("ext"));
            assertEquals(target, metadata.getString("url"));
            File output = new File(directory, "downloaded.webm");
            YtDlpRuntime.execute(context, List.of("--socket-timeout", "5",
                "--output", output.getAbsolutePath(), target), "proxy-forwarding-test", null);
            assertArrayEquals(proxy.media, YtDlpFiles.readFile(output));
            proxy.assertForwarded("/demo.webm");
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    @Test public void nativeHttpAndMedia3UseProxyWithoutResolvingDestination() throws Exception {
        AndroidProxy.ready().get(10, TimeUnit.SECONDS);
        try (RecordingProxy proxy = new RecordingProxy()) {
            proxy.configure();
            HttpURLConnection connection = (HttpURLConnection) new URL(TARGET).openConnection();
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            try { assertThrows(Exception.class, connection::getInputStream); }
            finally { connection.disconnect(); }
            proxy.assertContacted();
        }
        try (RecordingProxy proxy = new RecordingProxy()) {
            proxy.configure();
            DefaultHttpDataSource source = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(3000).setReadTimeoutMs(3000).createDataSource();
            try { assertThrows(Exception.class, () -> source.open(new DataSpec(Uri.parse(TARGET)))); }
            finally { source.close(); }
            proxy.assertContacted();
        }
    }

    @Test public void webViewFetchUsesProxyOverride() throws Exception {
        AndroidProxy.ready().get(10, TimeUnit.SECONDS);
        try (RecordingProxy proxy = new RecordingProxy()) {
            proxy.configure();
            AtomicReference<WebView> view = new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView web = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
                view.set(web);
                AndroidProxy.protectWebView(web);
                web.getSettings().setJavaScriptEnabled(true);
                web.setWebViewClient(new WebViewClient());
                web.loadDataWithBaseURL("https://localhost", "<script>fetch('" + TARGET + "').catch(()=>{})</script>", "text/html", "UTF-8", null);
            });
            try { proxy.assertContacted(); }
            finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.get().destroy()); }
        }
    }

    @Test public void ytDlpCannotOverrideAppProxyWithCustomArguments() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (RecordingProxy proxy = new RecordingProxy()) {
            proxy.configure();
            assertThrows(Exception.class, () -> YtDlpRuntime.extract(context, List.of(
                "--proxy", "", "--skip-download", "--retries", "0", "--socket-timeout", "3", TARGET)));
            proxy.assertContacted();
        }
    }

    @Test public void webViewDoesNotBypassProxyForLoopbackDestinations() throws Exception {
        AndroidProxy.ready().get(10, TimeUnit.SECONDS);
        try (ServerSocket destination = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
             RecordingProxy proxy = new RecordingProxy("127.0.0.1:" + destination.getLocalPort())) {
            proxy.configure();
            AtomicReference<WebView> view = new AtomicReference<>();
            CountDownLatch finished = new CountDownLatch(1);
            String target = "https://127.0.0.1:" + destination.getLocalPort() + "/must-not-connect";
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView web = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
                view.set(web);
                AndroidProxy.protectWebView(web);
                web.getSettings().setJavaScriptEnabled(true);
                web.addJavascriptInterface(new Object() {
                    @android.webkit.JavascriptInterface public void complete() { finished.countDown(); }
                }, "testResult");
                web.setWebViewClient(new WebViewClient());
                web.loadDataWithBaseURL("https://localhost", "<script>fetch('" + target +
                    "').catch(()=>{}).finally(()=>testResult.complete())</script>", "text/html", "UTF-8", null);
            });
            try {
                assertTrue("Loopback destination bypassed the proxy", proxy.contacted.await(10, TimeUnit.SECONDS));
                assertTrue(proxy.request, proxy.request.startsWith("CONNECT 127.0.0.1:" + destination.getLocalPort() + " "));
                assertTrue(finished.await(10, TimeUnit.SECONDS));
                destination.setSoTimeout(200);
                assertThrows(SocketTimeoutException.class, destination::accept);
            } finally {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.get().destroy());
            }
        }
    }
}
