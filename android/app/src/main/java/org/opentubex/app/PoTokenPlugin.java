package org.opentubex.app;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.Map;

@CapacitorPlugin(name = "PoToken")
public class PoTokenPlugin extends Plugin {
    private static final long GENERATE_TIMEOUT_MS = 30_000;
    private static final Pattern EXPORT_PATTERN = Pattern.compile("export\\{(\\w+) as default\\};");
    private final SerialTaskQueue requestQueue = new SerialTaskQueue();

    @PluginMethod
    public void generate(PluginCall call) {
        String videoId = call.getString("videoId");
        String sessionContext = call.getString("sessionContext");
        String initialAttestationData = call.getString("initialAttestationData");
        String ytConfig = call.getString("ytConfig");

        if (videoId == null || sessionContext == null || initialAttestationData == null || ytConfig == null) {
            call.reject("Missing PO token parameters");
            return;
        }

        getActivity().runOnUiThread(() -> requestQueue.enqueue(() -> {
            try {
                String script = createBotGuardScript(
                    videoId,
                    sessionContext,
                    initialAttestationData,
                    ytConfig
                );
                runBotGuard(call, script);
            } catch (IOException | JSONException exception) {
                call.reject("Failed to prepare PO token generation", exception);
                requestQueue.complete();
            }
        }));
    }

    private String createBotGuardScript(
        String videoId,
        String sessionContext,
        String initialAttestationData,
        String ytConfig
    ) throws IOException, JSONException {
        String script;
        try (InputStream input = getContext().getAssets().open("public/botGuardScript.js");
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
            script = builder.toString();
        }

        Matcher exportMatcher = EXPORT_PATTERN.matcher(script);
        if (!exportMatcher.find()) {
            throw new IOException("BotGuard entry point was not found");
        }

        String invocation = String.format(
            ";%s(%s,%s,%s,%s)",
            exportMatcher.group(1),
            JSONObject.quote(videoId),
            new JSONObject(sessionContext),
            new JSONObject(initialAttestationData),
            new JSONObject(ytConfig)
        );
        return exportMatcher.replaceFirst(Matcher.quoteReplacement(invocation));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void runBotGuard(PluginCall call, String script) {
        WebView webView;
        try {
            webView = new WebView(getContext());
            AndroidProxy.protectWebView(webView);
        } catch (RuntimeException exception) {
            call.reject("Failed to prepare PO token generation", exception);
            requestQueue.complete();
            return;
        }

        Handler handler = new Handler(Looper.getMainLooper());
        boolean[] finished = { false };
        boolean[] cleanedUp = { false };

        Runnable cleanup = () -> {
            if (cleanedUp[0]) return;
            cleanedUp[0] = true;
            try {
                webView.stopLoading();
                webView.removeJavascriptInterface("OpenTubeXPoToken");
                webView.destroy();
            } finally {
                requestQueue.complete();
            }
        };

        Runnable timeout = () -> {
            if (finished[0]) return;
            finished[0] = true;
            try {
                call.reject("PO token generation timed out");
            } finally {
                cleanup.run();
            }
        };

        try {
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void resolve(String token) {
                    handler.post(() -> {
                        if (finished[0]) return;
                        finished[0] = true;
                        handler.removeCallbacks(timeout);
                        JSObject result = new JSObject();
                        result.put("token", token);
                        try {
                            call.resolve(result);
                        } finally {
                            cleanup.run();
                        }
                    });
                }

                @JavascriptInterface
                public void reject(String message) {
                    handler.post(() -> {
                        if (finished[0]) return;
                        finished[0] = true;
                        handler.removeCallbacks(timeout);
                        try {
                            call.reject(message);
                        } finally {
                            cleanup.run();
                        }
                    });
                }
            }, "OpenTubeXPoToken");

            webView.setWebViewClient(new BotGuardWebViewClient());

            String document = "<!doctype html><html><head><meta charset=\"UTF-8\"></head><body>" +
                "<script>" + script +
                ".then(token=>OpenTubeXPoToken.resolve(token))" +
                ".catch(error=>OpenTubeXPoToken.reject(String(error)))" +
                "</script></body></html>";

            handler.postDelayed(timeout, GENERATE_TIMEOUT_MS);
            webView.loadDataWithBaseURL(
                "https://www.youtube.com/",
                document,
                "text/html",
                "UTF-8",
                null
            );
        } catch (RuntimeException exception) {
            finished[0] = true;
            handler.removeCallbacks(timeout);
            try {
                call.reject("Failed to prepare PO token generation", exception);
            } finally {
                cleanup.run();
            }
        }
    }

    private static class BotGuardWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String method = request.getMethod();

            if ("data".equals(uri.getScheme())) {
                return super.shouldInterceptRequest(view, request);
            }

            if (
                "POST".equals(method) &&
                "www.youtube.com".equals(uri.getHost()) &&
                ("/youtubei/v1/att/get".equals(uri.getPath()) ||
                    "/api/jnn/v1/GenerateIT".equals(uri.getPath()))
            ) {
                return super.shouldInterceptRequest(view, request);
            }

            if (
                "GET".equals(method) &&
                "https".equals(uri.getScheme()) &&
                "www.google.com".equals(uri.getHost()) &&
                uri.getPath() != null &&
                uri.getPath().startsWith("/js/")
            ) {
                return loadGoogleInterpreter(request);
            }

            return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                403,
                "Forbidden",
                java.util.Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0])
            );
        }

        private WebResourceResponse loadGoogleInterpreter(WebResourceRequest request) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                for (java.util.Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
                connection.setRequestProperty("Referer", "https://www.google.com/");
                connection.setRequestProperty("Origin", "https://www.google.com");
                connection.setRequestProperty("Sec-Fetch-Dest", "script");
                connection.setRequestProperty("Sec-Fetch-Site", "cross-site");
                connection.setRequestProperty("Accept-Language", "*");

                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream == null) stream = new ByteArrayInputStream(new byte[0]);

                Map<String, String> headers = AndroidHttpUtils.flattenHeaders(
                    connection.getHeaderFields()
                );
                headers.put("Access-Control-Allow-Origin", "*");

                return new WebResourceResponse(
                    AndroidHttpUtils.mimeType(
                        connection.getContentType(),
                        "application/javascript"
                    ),
                    null,
                    status,
                    connection.getResponseMessage() == null ? "" : connection.getResponseMessage(),
                    headers,
                    AndroidHttpUtils.disconnectOnClose(stream, connection)
                );
            } catch (IOException exception) {
                if (connection != null) connection.disconnect();
                return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    new ByteArrayInputStream(new byte[0])
                );
            }
        }
    }

}
