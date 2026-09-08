package org.opentubex.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Exercises the shipped APK without depending on classes that R8 can inline or remove. */
public class OptimizedApkInstrumentation extends Instrumentation {
    private volatile Activity resumedActivity;
    private boolean permissionsOnly;

    @Override public void callActivityOnResume(Activity activity) {
        super.callActivityOnResume(activity);
        resumedActivity = activity;
    }

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        permissionsOnly = arguments != null && "true".equals(arguments.getString("permissionsOnly"));
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        Activity activity = null;
        File fixture = new File(getTargetContext().getCacheDir(), "optimized-apk-demo.webm");
        File converted = new File(getTargetContext().getCacheDir(), "optimized-apk-demo.mp3");
        int resultCode = Activity.RESULT_CANCELED;
        try {
            Intent intent = new Intent().setClassName(getTargetContext(), "org.opentubex.app.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(intent);
            AtomicReference<WebView> found = new AtomicReference<>();
            Activity launched = activity;
            runOnMainSync(() -> found.set(findWebView(launched.getWindow().getDecorView())));
            WebView web = found.get();
            check(web != null, "Main activity has a WebView");
            await(web, "document.readyState === 'complete' && !!window.Capacitor");
            check(call(web, "App", "getInfo", new JSONObject()).getString("id")
                .equals(getTargetContext().getPackageName()), "Generated Capacitor plugins survive shrinking");
            String permission = call(web, "LocalNotifications", "checkPermissions", new JSONObject()).getString("display");
            check(Arrays.asList("granted", "denied", "prompt", "prompt-with-rationale").contains(permission),
                "Notification permission metadata survives shrinking: " + permission);
            report("Bridge passed");
            if (permissionsOnly) {
                result.putString("stream", "\nOK (startup and notification permissions)\n");
                resultCode = Activity.RESULT_OK;
                return;
            }

            JSONObject info = call(web, "YtDlp", "info", new JSONObject());
            for (String binary : new String[] { "ytDlp", "ffmpeg", "ffprobe" }) {
                check(info.getJSONObject(binary).getBoolean("available"), binary + " is available");
                check(!info.getJSONObject(binary).getString("version").isEmpty(), binary + " executes");
            }
            try (var input = getContext().getAssets().open("demo.webm")) {
                Files.copy(input, fixture.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            check(execute("qjs", "--eval", "print(1 + 1)").trim().equals("2"), "QuickJS executes without its static archive");
            File script = new File(getTargetContext().getNoBackupFilesDir(), "youtubedl-android/yt-dlp/yt-dlp");
            check(execute("python", script.getPath(), "--enable-file-urls", "--dump-single-json", fixture.toURI().toString())
                .contains("optimized-apk-demo"), "Python and yt-dlp extract local media");
            execute("ffmpeg", "-y", "-i", fixture.getPath(), converted.getPath());
            check(converted.length() > 0, "FFmpeg converts audio");
            check(Double.parseDouble(execute("ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", converted.getPath()).trim()) > 0, "FFprobe reads converted audio");
            report("Runtimes passed");

            JSONObject owner = new JSONObject().put("owner", "optimized-apk-test");
            call(web, "AndroidPlayback", "setOwner", owner);
            try {
                call(web, "AndroidPlayback", "loadSource", new JSONObject(owner.toString())
                    .put("source", fixture.toURI().toString()).put("mimeType", "video/webm").put("play", true));
                call(web, "AndroidPlayback", "show", new JSONObject(owner.toString()).put("locale", "en-US"));
                long deadline = SystemClock.elapsedRealtime() + 15000;
                JSONObject state;
                do {
                    state = call(web, "AndroidPlayback", "getState", owner);
                    if (state.optDouble("position", 0) > 0) break;
                    Thread.sleep(100);
                } while (SystemClock.elapsedRealtime() < deadline);
                check(state.optDouble("position", 0) > 0, "Native playback advances: " + state);
            } finally { call(web, "AndroidPlayback", "release", owner); }
            report("Playback passed");

            JSONObject refresh = call(web, "SubscriptionRefresh", "start", new JSONObject()
                .put("title", "Optimized APK test").put("cancelLabel", "Cancel"));
            check(refresh.getBoolean("acquired"), "Subscription refresh starts");
            try {
                NotificationManager notifications = getTargetContext().getSystemService(NotificationManager.class);
                long deadline = SystemClock.elapsedRealtime() + 15000;
                boolean notified;
                do {
                    notified = Arrays.stream(notifications.getActiveNotifications())
                        .anyMatch(notification -> "Optimized APK test".contentEquals(
                            notification.getNotification().extras.getCharSequence("android.title", "")));
                    if (notified) break;
                    Thread.sleep(100);
                } while (SystemClock.elapsedRealtime() < deadline);
                check(notified, "WorkManager instantiates the shrunk worker and posts its notification");
            } finally {
                call(web, "SubscriptionRefresh", "finish", new JSONObject().put("token", refresh.getString("token")));
            }
            report("Worker passed");

            evaluate(web, "window.optimizedScan = 'pending'; Capacitor.nativePromise('CapacitorBarcodeScanner', 'scanBarcode', " +
                "{hint: 0, cameraDirection: 1, scanOrientation: 3, scanButton: false, android: {scanningLibrary: 'zxing'}})" +
                ".then(() => window.optimizedScan = 'scanned', error => window.optimizedScan = error.code)");
            long scannerDeadline = SystemClock.elapsedRealtime() + 15000;
            AtomicReference<Boolean> scannerReady = new AtomicReference<>(false);
            do {
                runOnMainSync(() -> scannerReady.set(resumedActivity != null && resumedActivity.hasWindowFocus() &&
                    resumedActivity.getClass().getName().equals("com.outsystems.plugins.barcode.view.OSBARCScannerActivity")));
                if (scannerReady.get()) break;
                Thread.sleep(100);
            } while (SystemClock.elapsedRealtime() < scannerDeadline);
            check(scannerReady.get(), "Native QR scanner opens and receives focus");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            await(web, "window.optimizedScan === 'OS-PLUG-BARC-0006'");
            result.putString("stream", "\nOK (5 checks: bridge, runtimes, playback, worker, scanner)\n");
            resultCode = Activity.RESULT_OK;
        } catch (Throwable failure) {
            result.putString("stream", "\nFAILURE\n" + android.util.Log.getStackTraceString(failure));
        } finally {
            if (activity != null) {
                Activity opened = activity;
                runOnMainSync(opened::finish);
            }
            fixture.delete();
            converted.delete();
            finish(resultCode, result);
        }
    }

    private void report(String message) {
        Bundle status = new Bundle();
        status.putString("stream", message + "\n");
        sendStatus(0, status);
    }

    private String execute(String binary, String... arguments) throws Exception {
        File nativeDir = new File(getTargetContext().getApplicationInfo().nativeLibraryDir);
        File packages = new File(getTargetContext().getNoBackupFilesDir(), "youtubedl-android/packages");
        var command = new java.util.ArrayList<String>();
        command.add(new File(nativeDir, "lib" + binary + ".so").getPath());
        command.addAll(Arrays.asList(arguments));
        File log = new File(getTargetContext().getCacheDir(), "optimized-apk-process.log");
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log);
        builder.environment().put("LD_LIBRARY_PATH", new File(packages, "python/usr/lib") + ":" + new File(packages, "ffmpeg/usr/lib"));
        builder.environment().put("PYTHONHOME", new File(packages, "python/usr").getPath());
        Process process = builder.start();
        try {
            check(process.waitFor(30, TimeUnit.SECONDS), binary + " finishes");
            String output = new String(Files.readAllBytes(log.toPath()), java.nio.charset.StandardCharsets.UTF_8);
            check(process.exitValue() == 0, binary + ": " + output);
            return output;
        } finally { process.destroyForcibly(); log.delete(); }
    }

    private JSONObject call(WebView web, String plugin, String method, JSONObject options) throws Exception {
        evaluate(web, "window.optimizedResult = null; Capacitor.nativePromise(" + JSONObject.quote(plugin) + "," +
            JSONObject.quote(method) + "," + options + ").then(value => window.optimizedResult = {value: value || {}}," +
            "error => window.optimizedResult = {error: String(error)})");
        await(web, "window.optimizedResult !== null");
        JSONObject result = new JSONObject(evaluate(web, "window.optimizedResult"));
        check(!result.has("error"), plugin + "." + method + ": " + result);
        return result.getJSONObject("value");
    }

    private void await(WebView web, String condition) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 30000;
        do {
            if ("true".equals(evaluate(web, condition))) return;
            Thread.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Timed out: " + condition);
    }

    private String evaluate(WebView web, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        check(done.await(5, TimeUnit.SECONDS), "WebView responds");
        return value.get();
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup group) {
            for (int index = 0; index < group.getChildCount(); index++) {
                WebView found = findWebView(group.getChildAt(index));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
