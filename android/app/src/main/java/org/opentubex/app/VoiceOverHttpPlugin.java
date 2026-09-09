package org.opentubex.app;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import java.io.IOException;

/** Cookie-free binary transport for the existing VOT client. */
@CapacitorPlugin(name = "VoiceOverHttp")
public class VoiceOverHttpPlugin extends Plugin {
    private static final int MAX_MESSAGE_BYTES = 1024 * 1024;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build();

    static boolean isAllowedUrl(HttpUrl url) {
        if (url == null || !url.isHttps() || url.port() != 443 ||
            !url.username().isEmpty() || !url.password().isEmpty()) return false;
        String host = url.host();
        return host.equals("api.browser.yandex.ru") ||
            host.equals("strm.yandex.net") || host.endsWith(".strm.yandex.net") ||
            host.equals("strm.yandex.ru") || host.endsWith(".strm.yandex.ru") ||
            host.equals("vtrans.s3-private.mds.yandex.net") ||
            host.equals("storage.yandexcloud.net");
    }

    @PluginMethod
    public void request(PluginCall call) {
        HttpUrl url = HttpUrl.parse(call.getString("url", ""));
        String method = call.getString("method", "GET");
        boolean headersOnly = call.getBoolean("headersOnly", false);
        if (!isAllowedUrl(url) || !(method.equals("GET") || method.equals("POST") || method.equals("PUT"))) {
            call.reject("Invalid voice-over request");
            return;
        }
        final Request request;
        try {
            String encoded = call.getString("body", "");
            if (encoded.length() > MAX_MESSAGE_BYTES * 4 / 3 + 4) throw new IllegalArgumentException("Request too large");
            byte[] body = Base64.decode(encoded, Base64.DEFAULT);
            Request.Builder builder = new Request.Builder().url(url).method(method,
                method.equals("GET") ? null : RequestBody.create(body, null));
            JSObject headers = call.getObject("headers", new JSObject());
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                if (name.equalsIgnoreCase("cookie") || name.equalsIgnoreCase("authorization") ||
                    name.equalsIgnoreCase("host") || name.equalsIgnoreCase("proxy-authorization")) continue;
                builder.header(name, headers.getString(name));
            }
            request = builder.build();
        } catch (Exception error) {
            call.reject("Invalid voice-over request", error);
            return;
        }
        client.newCall(request).enqueue(new Callback() {
            @Override public void onFailure(Call ignored, IOException error) {
                call.reject("Voice-over request failed", error);
            }
            @Override public void onResponse(Call ignored, Response response) {
                try (Response received = response) {
                    JSObject headers = new JSObject();
                    for (String name : received.headers().names()) headers.put(name, received.header(name));
                    byte[] data = new byte[0];
                    if (!headersOnly && received.body() != null) {
                        data = received.peekBody(MAX_MESSAGE_BYTES + 1).bytes();
                        if (data.length > MAX_MESSAGE_BYTES) throw new IOException("Voice-over response too large");
                    }
                    JSObject result = new JSObject();
                    result.put("status", received.code());
                    result.put("headers", headers);
                    result.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                    call.resolve(result);
                } catch (IOException error) {
                    call.reject("Voice-over response failed", error);
                }
            }
        });
    }

    @Override protected void handleOnDestroy() {
        client.dispatcher().cancelAll();
        client.connectionPool().evictAll();
        super.handleOnDestroy();
    }
}
