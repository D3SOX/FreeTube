package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.ParcelFileDescriptor;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import androidx.camera.camera2.Camera2Config;
import androidx.camera.core.CameraXConfig;
import androidx.camera.lifecycle.ProcessCameraProvider;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PairingCameraTest {
    @Test
    public void nativePairingDoesNotBundleMlKit() {
        assertThrows(ClassNotFoundException.class,
            () -> Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning"));
    }

    @Test
    public void nativePairingScannerOpensAndReturnsCancellationWithoutCrashing() throws Exception {
        String packageName = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        try (ParcelFileDescriptor.AutoCloseInputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("pm grant " + packageName + " " + Manifest.permission.CAMERA))) {
            while (output.read() != -1) {}
        }
        assertEquals("Android must be able to grant camera access for pairing", PackageManager.PERMISSION_GRANTED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.CAMERA));
        // Hold real CameraX initialization so startup responsiveness does not
        // depend on the speed of the device or a previously warmed camera.
        var cameraExecutor = Executors.newSingleThreadExecutor();
        CountDownLatch initializing = new CountDownLatch(1);
        CountDownLatch initialize = new CountDownLatch(1);
        ProcessCameraProvider.configureInstance(CameraXConfig.Builder.fromConfig(Camera2Config.defaultConfig())
            .setCameraExecutor(task -> cameraExecutor.execute(() -> {
                initializing.countDown();
                try {
                    if (!initialize.await(15, TimeUnit.SECONDS)) throw new AssertionError("Camera initialization was not released");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return;
                }
                task.run();
            })).build());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            awaitValue(view.get(), "location.protocol === 'https:' && document.readyState === 'complete'", "true");
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            evaluate(view.get(),
                "window.pairingCameraResult = 'pending';" +
                "window.Capacitor.nativePromise('CapacitorBarcodeScanner', 'scanBarcode', {" +
                "hint: 0, cameraDirection: 1, scanOrientation: 3, scanButton: false," +
                "android: {scanningLibrary: 'zxing'}, cancelButtonAccessibilityLabel: 'Cancel'" +
                "}).then(function() { window.pairingCameraResult = 'scanned'; }," +
                "function(error) { window.pairingCameraResult = error.code; });"
            );
            boolean stayedResponsive = true;
            String blockedStack = "";
            try {
                assertTrue("Camera initialization starts", initializing.await(10, TimeUnit.SECONDS));
                // Keep posting while initialization is held. A blocking get()
                // in the scanner activity must fail this check, not hang the test.
                for (int i = 0; i < 10; i++) {
                    CountDownLatch responsive = new CountDownLatch(1);
                    new Handler(Looper.getMainLooper()).post(responsive::countDown);
                    if (!responsive.await(2, TimeUnit.SECONDS)) {
                        stayedResponsive = false;
                        blockedStack = java.util.Arrays.toString(Looper.getMainLooper().getThread().getStackTrace());
                        break;
                    }
                    Thread.sleep(100);
                }
            } finally { initialize.countDown(); }
            awaitNativeScanner();
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitValue(view.get(), "window.pairingCameraResult", "\"OS-PLUG-BARC-0006\"");
            assertTrue("Main thread stays responsive while the camera initializes: " + blockedStack, stayedResponsive);
        } finally {
            initialize.countDown();
            ProcessCameraProvider.shutdown().get(10, TimeUnit.SECONDS);
            cameraExecutor.shutdownNow();
        }
    }

    private static void awaitNativeScanner() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        AtomicReference<Boolean> opened = new AtomicReference<>(false);
        do {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                    if (activity.getClass().getName().equals("com.outsystems.plugins.barcode.view.OSBARCScannerActivity")) {
                        opened.set(true);
                    }
                }
            });
            if (opened.get()) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertTrue("Native QR scanner opens", opened.get());
    }

    private static void awaitValue(WebView view, String script, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        String actual;
        do {
            actual = evaluate(view, script);
            if (expected.equals(actual)) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(expected, actual);
    }

    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> {
                result.set(value);
                evaluated.countDown();
            })
        );
        assertTrue("WebView responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
