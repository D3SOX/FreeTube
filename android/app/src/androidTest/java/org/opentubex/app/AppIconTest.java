package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.app.Instrumentation;
import android.app.Activity;
import org.json.JSONArray;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.lifecycle.Lifecycle;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AppIconTest {
    @Test
    public void missingLauncherIconDoesNotPreventStartup() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String original = AppIconPlugin.current(context);
        try {
            for (ActivityInfo alias : AppIconPlugin.aliases(context)) {
                context.getPackageManager().setComponentEnabledSetting(
                    new ComponentName(context.getPackageName(), alias.name),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                assertEquals(Lifecycle.State.RESUMED, scenario.getState());
            }
        } finally {
            AppIconPlugin.select(context, original);
        }
    }

    @Test
    public void recentsUsesSelectedIconOnLaunchAndAfterSelection() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String original = AppIconPlugin.current(context);
        try {
            AppIconPlugin.select(context, "dracula");
            try (LauncherSession scenario = LauncherSession.launch(context)) {
                await(scenario, "!!document.querySelector('#app')?.__vue_app__");
                assertRecentsIcon(scenario, "dracula");
                evaluate(scenario, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow')");
                await(scenario, "!!document.querySelector('.settingsMenu [data-section=appearance]')");
                evaluate(scenario, "document.querySelector('.settingsMenu [data-section=appearance]').click()");
                await(scenario, "!!document.querySelector('.appIconSettingsButton')");
                evaluate(scenario, "document.querySelector('.appIconSettingsButton').click()");
                await(scenario, "!!document.querySelector('.appIconPresets:not(:disabled) input:checked')");
                evaluate(scenario, "document.querySelector('.appIconPreset input[value=light]').click()");
                await(scenario, "!!document.querySelector('.appIconAppliedPrompt')");
                assertRecentsIcon(scenario, "light");
                tap(scenario, ".appIconAppliedPrompt button:last-child");
            }
            try (LauncherSession scenario = LauncherSession.launch(context)) {
                await(scenario, "!!document.querySelector('#app')?.__vue_app__");
                assertRecentsIcon(scenario, "light");
            }
        } finally {
            AppIconPlugin.select(context, original);
        }
    }

    private static void assertRecentsIcon(LauncherSession scenario, String preset) {
        scenario.onActivity(activity -> {
            try {
                int icon = activity.getPackageManager().getActivityInfo(
                    new ComponentName(activity.getPackageName(), "org.opentubex.app.launcher." + preset),
                    PackageManager.MATCH_DISABLED_COMPONENTS).getIconResource();
                android.app.ActivityManager manager = activity.getSystemService(android.app.ActivityManager.class);
                android.app.ActivityManager.RecentTaskInfo task = manager.getAppTasks().stream()
                    .map(android.app.ActivityManager.AppTask::getTaskInfo)
                    .filter(info -> info.id == activity.getTaskId()).findFirst().orElseThrow();
                android.graphics.Bitmap actual = task.taskDescription.getIcon();
                assertNotNull("Recent apps has the selected bitmap", actual);
                android.graphics.Bitmap expected = android.graphics.Bitmap.createBitmap(
                    actual.getWidth(), actual.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.drawable.Drawable drawable = activity.getDrawable(icon);
                drawable.setBounds(0, 0, expected.getWidth(), expected.getHeight());
                drawable.draw(new android.graphics.Canvas(expected));
                assertTrue("Recent apps should use " + preset, actual.sameAs(expected));
            } catch (PackageManager.NameNotFoundException error) {
                throw new AssertionError(error);
            }
        });
    }

    @Test
    public void dismissKeepsLauncherStartedActivityOpen() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String original = AppIconPlugin.current(context);
        String chosen = original.equals("dracula") ? "light" : "dracula";
        try (LauncherSession scenario = LauncherSession.launch(context)) {
            await(scenario, "!!document.querySelector('#app')?.__vue_app__");
            evaluate(scenario, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow')");
            await(scenario, "!!document.querySelector('.settingsMenu [data-section=appearance]')");
            evaluate(scenario, "document.querySelector('.settingsMenu [data-section=appearance]').click()");
            await(scenario, "!!document.querySelector('.appIconSettingsButton')");
            evaluate(scenario, "document.querySelector('.appIconSettingsButton').click()");
            await(scenario, "!!document.querySelector('.appIconPresets:not(:disabled) input:checked')");
            String preset = ".appIconPreset input[value=" + chosen + "]";
            evaluate(scenario, "document.querySelector('" + preset + "').scrollIntoView({ block: 'center' })");
            tap(scenario, preset);
            await(scenario, "!!document.querySelector('.appIconAppliedPrompt')");
            tap(scenario, ".appIconAppliedPrompt button:last-child");
            await(scenario, "!document.querySelector('.appIconAppliedPrompt')");
            // PackageManager can defer its component-change broadcast by ten
            // seconds after boot. Dismiss must survive that deferred work too.
            long deadline = SystemClock.uptimeMillis() + 12000;
            while (SystemClock.uptimeMillis() < deadline) {
                assertEquals("Dismiss keeps the launcher-started activity open", Lifecycle.State.RESUMED, scenario.getState());
                Thread.sleep(250);
            }
            assertEquals(chosen, AppIconPlugin.current(context));
            evaluate(scenario, "window.iconTestStillRunning = true");
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_HOME);
            context.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
            long resumeDeadline = SystemClock.uptimeMillis() + 5000;
            while (scenario.getState() != Lifecycle.State.RESUMED && SystemClock.uptimeMillis() < resumeDeadline) {
                Thread.sleep(100);
            }
            assertEquals("Launcher returns to the existing app", Lifecycle.State.RESUMED, scenario.getState());
            assertEquals("true", evaluate(scenario, "window.iconTestStillRunning === true"));
        } finally {
            AppIconPlugin.select(context, original);
        }
    }

    @Test
    public void pickerChangesNativeIconAndKeepsShortcuts() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String original = AppIconPlugin.current(context);
        ShortcutManager shortcuts = context.getSystemService(ShortcutManager.class);
        AppIconPlugin.select(context, "default");
        try (LauncherSession scenario = LauncherSession.launch(context)) {
            await(scenario, "!!document.querySelector('#app')?.__vue_app__");
            evaluate(scenario, """
                window.iconTestApp = document.querySelector('#app').__vue_app__.config.globalProperties;
                window.iconTestOriginalScale = iconTestApp.$store.getters.getUiScale;
                window.iconTestOriginalTheme = iconTestApp.$store.getters.getBaseTheme;
                iconTestApp.$store.dispatch('showSettingsWindow');
                """);
            await(scenario, "!!document.querySelector('.settingsMenu [data-section=appearance]')");
            evaluate(scenario, "document.querySelector('.settingsMenu [data-section=appearance]').click()");
            await(scenario, "!!document.querySelector('.appIconSettingsButton')");
            assertEquals("true", evaluate(scenario, "!!document.querySelector('.appIconActions .appIconSettingsButton') && !document.querySelector('.customThemeActions .appIconSettingsButton')"));
            assertEquals("0", evaluate(scenario, "document.querySelectorAll('.appIconPresets').length"));
            evaluate(scenario, "document.querySelector('.appIconSettingsButton').click()");
            await(scenario, "!!document.querySelector('.appIconPresets:not(:disabled) input:checked')");
            assertEquals("true", evaluate(scenario, "!!document.querySelector('.settingsSubpageScroll .appIconPresets')"));
            await(scenario, "[...document.querySelectorAll('.appIconPreset img')].every(img => img.complete && img.naturalWidth > 0)");
            assertEquals("31", evaluate(scenario, "document.querySelectorAll('.appIconPreset').length"));

            ShortcutInfo shortcut = new ShortcutInfo.Builder(context, "icon-test")
                .setShortLabel("Icon test")
                .setIntent(new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW))
                .build();
            assertTrue(shortcuts.addDynamicShortcuts(List.of(shortcut)));
            evaluate(scenario, "document.querySelector('.appIconPreset input[value=dracula]').click()");
            await(scenario, "!document.querySelector('.appIconPresets').disabled && document.querySelector('.appIconPreset input:checked').value === 'dracula'");
            assertEquals("dracula", AppIconPlugin.current(context));
            await(scenario, "!!document.querySelector('.appIconAppliedPrompt')");
            tap(scenario, ".appIconAppliedPrompt button:last-child");
            await(scenario, "!document.querySelector('.appIconAppliedPrompt')");
            Thread.sleep(2500);
            assertEquals(Lifecycle.State.RESUMED, scenario.getState());
            assertEquals("dracula", AppIconPlugin.current(context));
            ShortcutInfo updated = shortcuts.getDynamicShortcuts().stream()
                .filter(item -> item.getId().equals("icon-test")).findFirst().orElseThrow();
            assertEquals("org.opentubex.app.launcher.dracula", updated.getActivity().getClassName());
            assertEquals("Icon test", updated.getShortLabel().toString());
            assertEquals(MainActivity.class.getName(), updated.getIntent().getComponent().getClassName());

            try {
                for (String theme : List.of("light", "dark")) {
                    evaluate(scenario, "iconTestApp.$store.commit('setBaseTheme', '" + theme + "')");
                    for (int scale : new int[] {85, 125, 200}) {
                        evaluate(scenario, "document.querySelector('.appIconPreset:last-child').scrollIntoView({ block: 'end' })");
                        evaluate(scenario, "iconTestApp.$store.dispatch('updateUiScale', " + scale + ")");
                        await(scenario, "[...document.querySelectorAll('.appIconPreset')].every(el => { const r = el.getBoundingClientRect(); const p = el.parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1 })");
                        await(scenario, "(() => { const host = document.querySelector('.settingsSubpageScroll'); const viewport = host.querySelector('[data-overlayscrollbars-viewport]') || host; const last = document.querySelector('.appIconPreset:last-child').getBoundingClientRect(); const rect = viewport.getBoundingClientRect(); const padding = parseFloat(getComputedStyle(viewport).paddingBottom) * rect.height / viewport.offsetHeight; return viewport.scrollTop === 0 || last.bottom >= rect.bottom - padding - 2 })()");
                        await(scenario, """
                            (() => {
                              const host = document.querySelector('.settingsSubpageScroll');
                              const viewport = host.querySelector('[data-overlayscrollbars-viewport]') || host;
                              const bar = host.querySelector('.os-scrollbar-vertical');
                              if (!bar) return false;
                              const overflow = viewport.scrollHeight > viewport.clientHeight + 1;
                              if (bar.classList.contains('os-scrollbar-unusable') === overflow) return false;
                              if (!overflow) return true;
                              const track = bar.querySelector('.os-scrollbar-track');
                              const handle = bar.querySelector('.os-scrollbar-handle');
                              const trackRect = track.getBoundingClientRect();
                              const handleRect = handle.getBoundingClientRect();
                              const minSize = parseFloat(getComputedStyle(handle).minHeight) || 0;
                              const ratio = Math.min(1, Math.max(minSize / track.clientHeight, viewport.clientHeight / viewport.scrollHeight));
                              const offset = (trackRect.height - handleRect.height) * viewport.scrollTop / (viewport.scrollHeight - viewport.clientHeight);
                              return Math.abs(handleRect.height - ratio * trackRect.height) < 2 &&
                                Math.abs(handleRect.top - trackRect.top - offset) < 2;
                            })()
                            """);
                    }
                }
            } finally {
                evaluate(scenario, "iconTestApp.$store.commit('setBaseTheme', iconTestOriginalTheme)");
                evaluate(scenario, "iconTestApp.$store.dispatch('updateUiScale', iconTestOriginalScale)");
            }
            evaluate(scenario, "document.querySelector('.appIconPreset:last-child').scrollIntoView({ block: 'end' })");
            evaluate(scenario, "document.querySelector('.settingsBackButton').click()");
            await(scenario, "!document.querySelector('.appIconPresets')");
            evaluate(scenario, "document.querySelector('.appIconSettingsButton').click()");
            await(scenario, "!!document.querySelector('.appIconPreset input:checked') && document.querySelector('.appIconPreset input:checked').value === 'dracula'");
            await(scenario, "(() => { const host = document.querySelector('.settingsSubpageScroll'); return (host.querySelector('[data-overlayscrollbars-viewport]') || host).scrollTop === 0 })()");
            evaluate(scenario, "document.querySelector('.appIconPreset input[value=default]').click()");
            await(scenario, "!document.querySelector('.appIconPresets').disabled && document.querySelector('.appIconPreset input:checked').value === 'default'");
            assertEquals("default", AppIconPlugin.current(context));
            await(scenario, "!!document.querySelector('.appIconAppliedPrompt')");
            // Process restart is checked externally in _scripts/android/test-app-icon-restart.mjs:
            // killing the app would also terminate this instrumentation runner.
            tap(scenario, ".appIconAppliedPrompt button:last-child");
            await(scenario, "!document.querySelector('.appIconAppliedPrompt')");
        } finally {
            shortcuts.removeDynamicShortcuts(List.of("icon-test"));
            AppIconPlugin.select(context, original);
        }
    }

    @Test
    public void presetsKeepExactlyOneLauncherAndPreserveDeepLinks() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String original = AppIconPlugin.current(context);
        PackageManager manager = context.getPackageManager();
        try {
            for (ActivityInfo alias : AppIconPlugin.aliases(context)) {
                String name = alias.name.substring(alias.name.lastIndexOf('.') + 1);
                AppIconPlugin.select(context, name);
                assertEquals(name, AppIconPlugin.current(context));
                Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage(context.getPackageName());
                assertEquals(1, manager.queryIntentActivities(launcher, 0).size());
                assertEquals(alias.name, manager.getLaunchIntentForPackage(context.getPackageName()).getComponent().getClassName());
                assertNotEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    manager.getComponentEnabledSetting(new ComponentName(context, MainActivity.class)));
                Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=test"))
                    .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context.getPackageName());
                assertEquals(MainActivity.class.getName(), manager.resolveActivity(link, 0).activityInfo.name);
            }
            String before = AppIconPlugin.current(context);
            try {
                AppIconPlugin.select(context, "not-a-preset");
                fail("Unknown presets must be rejected");
            } catch (IllegalArgumentException expected) {
                assertEquals(before, AppIconPlugin.current(context));
            }
            AppIconPlugin.select(context, "dracula");
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                scenario.recreate();
                assertEquals("dracula", AppIconPlugin.current(context));
            }
            AppIconPlugin.select(context, "default");
            assertEquals("default", AppIconPlugin.current(context));
        } finally {
            AppIconPlugin.select(context, original);
        }
    }

    private static final class LauncherSession implements AutoCloseable {
        final MainActivity activity;

        LauncherSession(MainActivity activity) {
            this.activity = activity;
        }

        static LauncherSession launch(Context context) {
            Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
            Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(MainActivity.class.getName(), null, false);
            try {
                context.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
                Activity activity = monitor.waitForActivityWithTimeout(10000);
                assertTrue("Launcher opens MainActivity", activity instanceof MainActivity);
                return new LauncherSession((MainActivity) activity);
            } finally {
                instrumentation.removeMonitor(monitor);
            }
        }

        void onActivity(java.util.function.Consumer<MainActivity> action) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                assertFalse("Launcher-started activity remains alive", activity.isDestroyed());
                action.accept(activity);
            });
        }

        Lifecycle.State getState() {
            return activity.getLifecycle().getCurrentState();
        }

        @Override
        public void close() {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finishAndRemoveTask);
        }
    }

    private static String evaluate(LauncherSession scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView responds", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void tap(LauncherSession scenario, String selector) throws Exception {
        // Wait for the prompt's entry animation before locating a real touch.
        Thread.sleep(250);
        JSONArray bounds = new JSONArray(evaluate(scenario, "(() => { const r = document.querySelector('" + selector + "').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, innerWidth] })()"));
        float[] point = new float[2];
        scenario.onActivity(activity -> {
            int[] location = new int[2];
            activity.getBridge().getWebView().getLocationOnScreen(location);
            double scale = activity.getBridge().getWebView().getWidth() / bounds.optDouble(2);
            point[0] = location[0] + (float) (bounds.optDouble(0) * scale);
            point[1] = location[1] + (float) (bounds.optDouble(1) * scale);
        });
        long down = SystemClock.uptimeMillis();
        for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
            MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, point[0], point[1], 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(event);
            event.recycle();
        }
    }

    private static void await(LauncherSession scenario, String script) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        do {
            if ("true".equals(evaluate(scenario, script))) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(script, "true", evaluate(scenario, script));
    }
}
