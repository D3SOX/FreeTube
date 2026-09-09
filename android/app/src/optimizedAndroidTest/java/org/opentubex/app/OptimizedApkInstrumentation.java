package org.opentubex.app;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ShortcutManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import org.json.JSONArray;
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

            // WebView detects fullscreen support from WebChromeClient overrides,
            // including the empty onHideCustomView method that R8 can remove.
            check("true".equals(evaluate(web, "document.fullscreenEnabled")), "WebView advertises fullscreen support");
            checkLauncherShortcuts(web);
            report("Launcher shortcuts passed");
            checkPluginCallbacks(web, permission);
            report("Plugin callbacks passed");

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
            if (getTargetContext().checkSelfPermission(android.Manifest.permission.CAMERA)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                clickPermissionAllow();
            }
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
            result.putString("stream", "\nOK (7 checks: bridge, shortcuts, callbacks, runtimes, playback, worker, scanner)\n");
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

    private void checkLauncherShortcuts(WebView web) throws Exception {
        // These names come from the renderer, so Java resource references in
        // this test would hide a resource-shrinking regression.
        String[] pages = { "subscriptions", "userplaylists", "history", "downloads" };
        String[] icons = { "subscriptions", "playlists", "history", "downloads" };
        JSONArray shortcuts = new JSONArray();
        for (int index = 0; index < pages.length; index++) {
            shortcuts.put(new JSONObject().put("id", pages[index]).put("title", pages[index])
                .put("androidIcon", "ic_shortcut_" + icons[index]));
        }
        ShortcutManager manager = getTargetContext().getSystemService(ShortcutManager.class);
        var previous = manager.getDynamicShortcuts();
        try {
            call(web, "AppShortcuts", "set", new JSONObject().put("shortcuts", shortcuts));
            var registered = manager.getDynamicShortcuts();
            for (int index = 0; index < pages.length; index++) {
                String page = pages[index];
                check(registered.stream().anyMatch(shortcut -> shortcut.getId().equals(page)),
                    "Launcher shortcut is registered: " + page);
                int resource = getTargetContext().getResources().getIdentifier("ic_shortcut_" + icons[index],
                    "drawable", getTargetContext().getPackageName());
                check(resource != 0 && getTargetContext().getDrawable(resource) != null,
                    "Launcher shortcut icon survives resource shrinking: " + page);
            }
        } finally { manager.setDynamicShortcuts(previous); }
    }

    private void checkPluginCallbacks(WebView web, String permission) throws Exception {
        // A permission check alone does not exercise the reflected result callback.
        if (!permission.equals("granted")) {
            beginCall(web, "LocalNotifications", "requestPermissions", new JSONObject());
            clickPermissionAllow();
            check(finishCall(web, "LocalNotifications.requestPermissions").getString("display").equals("granted"),
                "Notification permission callback survives shrinking");
        }
        JSONObject notification = new JSONObject().put("id", 91218).put("title", "Optimized notification test")
            .put("body", "Resource and callback check").put("channelId", "live-reminders")
            .put("foreground", true).put("isExactNotification", false);
        JSONObject notifications = new JSONObject().put("notifications", new JSONArray().put(notification));
        try {
            call(web, "LocalNotifications", "schedule", notifications);
            NotificationManager manager = getTargetContext().getSystemService(NotificationManager.class);
            long deadline = SystemClock.elapsedRealtime() + 5000;
            android.app.Notification delivered = null;
            do {
                for (var active : manager.getActiveNotifications()) {
                    if (active.getId() == 91218) delivered = active.getNotification();
                }
                if (delivered != null) break;
                Thread.sleep(100);
            } while (SystemClock.elapsedRealtime() < deadline);
            check(delivered != null, "Local notification is delivered");
            int expectedIcon = getTargetContext().getResources().getIdentifier("ic_stat_opentubex", "drawable",
                getTargetContext().getPackageName());
            check(expectedIcon != 0 && delivered.getSmallIcon().getResId() == expectedIcon,
                "Notification uses its configured icon after shrinking");
        } finally {
            call(web, "LocalNotifications", "cancel", notifications);
            call(web, "LocalNotifications", "removeDeliveredNotifications", notifications);
        }

        // Return a cancelled picker result through Android and Capacitor's real
        // activity-result dispatch, without depending on a document provider UI.
        checkCancelledPicker(web, "AndroidStorage", "chooseDirectory", new JSONObject(), Intent.ACTION_OPEN_DOCUMENT_TREE);
        JSONObject saved = checkCancelledPicker(web, "AndroidStorage", "saveFile", new JSONObject()
            .put("fileName", "optimized-test.txt").put("data", "dGVzdA=="), Intent.ACTION_CREATE_DOCUMENT);
        check(!saved.getBoolean("saved"), "Cancelled export resolves without saving");
        checkCancelledPicker(web, "YtDlp", "chooseCookies", new JSONObject(), Intent.ACTION_OPEN_DOCUMENT);

        // Fail before network access, inside the separate BotGuard WebView.
        // Its @JavascriptInterface rejection must reach the original plugin call.
        beginCall(web, "PoToken", "generate", new JSONObject().put("videoId", "optimized-test")
            .put("sessionContext", "{}").put("initialAttestationData", "{\"R\":{}}")
            .put("ytConfig", "{}"));
        await(web, "window.optimizedResult !== null");
        check(new JSONObject(evaluate(web, "window.optimizedResult")).optString("error")
            .contains("Failed to get BotGuard challenge"), "PO-token JavaScript rejection survives shrinking");
    }

    private JSONObject checkCancelledPicker(WebView web, String plugin, String method, JSONObject options,
                                            String action) throws Exception {
        IntentFilter filter = new IntentFilter(action);
        if (!action.equals(Intent.ACTION_OPEN_DOCUMENT_TREE)) {
            filter.addCategory(Intent.CATEGORY_OPENABLE);
            filter.addDataType("*/*");
        }
        ActivityMonitor monitor = addMonitor(filter, new ActivityResult(Activity.RESULT_CANCELED, null), true);
        try {
            JSONObject result = call(web, plugin, method, options);
            check(monitor.getHits() == 1, plugin + "." + method + " launches the picker");
            return result;
        } finally { removeMonitor(monitor); }
    }

    private void clickPermissionAllow() throws Exception {
        var automation = getUiAutomation();
        AccessibilityServiceInfo original = automation.getServiceInfo();
        AccessibilityServiceInfo info = automation.getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        automation.setServiceInfo(info);
        try {
            long deadline = SystemClock.elapsedRealtime() + 10000;
            do {
                AccessibilityNodeInfo root = automation.getRootInActiveWindow();
                if (root != null) {
                    for (String controller : new String[] { "com.android.permissioncontroller", "com.google.android.permissioncontroller" }) {
                        for (String id : new String[] { "permission_allow_button", "permission_allow_foreground_only_button" }) {
                            for (var button : root.findAccessibilityNodeInfosByViewId(controller + ":id/" + id)) {
                                if (button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
                            }
                        }
                    }
                }
                Thread.sleep(100);
            } while (SystemClock.elapsedRealtime() < deadline);
            throw new AssertionError("Permission dialog opens");
        } finally { automation.setServiceInfo(original); }
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
        beginCall(web, plugin, method, options);
        return finishCall(web, plugin + "." + method);
    }

    private void beginCall(WebView web, String plugin, String method, JSONObject options) throws Exception {
        evaluate(web, "window.optimizedResult = null; Capacitor.nativePromise(" + JSONObject.quote(plugin) + "," +
            JSONObject.quote(method) + "," + options + ").then(value => window.optimizedResult = {value: value || {}}," +
            "error => window.optimizedResult = {error: String(error)})");
    }

    private JSONObject finishCall(WebView web, String description) throws Exception {
        await(web, "window.optimizedResult !== null");
        JSONObject result = new JSONObject(evaluate(web, "window.optimizedResult"));
        check(!result.has("error"), description + ": " + result);
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
