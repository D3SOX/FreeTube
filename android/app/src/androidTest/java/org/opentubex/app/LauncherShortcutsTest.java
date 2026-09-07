package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import io.capawesome.capacitorjs.plugins.appshortcuts.AppShortcutsHelper;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class LauncherShortcutsTest {
    @Test
    public void shortcutIntentsDoNotInheritTheVideoThatOpenedTheApp() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent videoIntent = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("https://www.youtube.com/watch?v=BaW_jenozKc"));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(videoIntent)) {
            scenario.onActivity(activity -> {
                JSArray shortcuts = new JSArray();
                shortcuts.put(new JSObject().put("id", "history").put("title", "History"));
                try {
                    Intent intent = AppShortcutsHelper.createShortcutInfoCompatList(
                        shortcuts, context, activity.getBridge()
                    ).get(0).getIntent();
                    assertNull("A shortcut must not also reopen the launch video", intent.getData());
                    assertEquals("history", intent.getStringExtra("shortcutId"));
                } catch (Exception exception) {
                    throw new AssertionError(exception);
                }
            });
        }
    }

    @Test
    @SdkSuppress(minSdkVersion = 26)
    public void opensPagesOnStartupAndInTheRunningApp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String initialPage : new String[]{"history", "subscriptions", "userplaylists", "downloads"}) {
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(shortcutIntent(context, initialPage))) {
                assertPage(scenario, initialPage);
                // MainActivity is singleTask: launcher actions must reach the existing WebView.
                for (String page : new String[]{"subscriptions", "userplaylists", "history", "downloads"}) {
                    context.startActivity(shortcutIntent(context, page));
                    assertPage(scenario, page);
                }
            }
        }
    }

    private static Intent shortcutIntent(Context context, String page) {
        return new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra("shortcutId", page)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static void assertPage(ActivityScenario<MainActivity> scenario, String page) throws Exception {
        String getters = "document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store.getters";
        String expression = page.equals("downloads")
            ? getters + ".getSettingsWindowOpen && " + getters + ".getSettingsWindowView === 'downloads'"
            : "location.hash === '#/" + page + "' && !" + getters + ".getSettingsWindowOpen";
        long deadline = System.currentTimeMillis() + 45000;
        String actual = null;
        while (System.currentTimeMillis() < deadline) {
            actual = evaluate(scenario, expression);
            if ("true".equals(actual)) return;
            Thread.sleep(100);
        }
        assertEquals("Opened " + page, "true", actual);
    }

    @Test
    @SdkSuppress(minSdkVersion = 26)
    public void registersLocalizedShortcutsForThisInstallation() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(shortcutIntent(context, "history"))) {
            assertPage(scenario, "history");
            String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
            try {
                evaluate(scenario, "void " + store + ".dispatch('updateCurrentLocale', 'de-DE')");
                awaitShortcutLabels(context, manager, new String[]{"Abos", "Playlists", "Verlauf", "Downloads"});
            } finally {
                evaluate(scenario, "void " + store + ".dispatch('updateCurrentLocale', 'en-US')");
                awaitShortcutLabels(context, manager, new String[]{"Subscriptions", "Playlists", "History", "Downloads"});
            }
        }
    }

    private static void awaitShortcutLabels(Context context, ShortcutManager manager, String[] labels) throws Exception {
        String[] pages = {"subscriptions", "userplaylists", "history", "downloads"};
        long deadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < deadline) {
            List<ShortcutInfo> shortcuts = manager.getDynamicShortcuts();
            boolean matching = shortcuts.size() == pages.length;
            for (int index = 0; index < pages.length; index++) {
                final String page = pages[index];
                ShortcutInfo shortcut = shortcuts.stream().filter(item -> item.getId().equals(page)).findFirst().orElse(null);
                if (shortcut == null || !labels[index].contentEquals(shortcut.getShortLabel())) {
                    matching = false;
                    break;
                }
                Intent intent = shortcut.getIntent();
                assertNotNull(intent);
                assertEquals(Intent.ACTION_VIEW, intent.getAction());
                assertEquals(new ComponentName(context, MainActivity.class), intent.getComponent());
                assertEquals(page, intent.getStringExtra("shortcutId"));
                assertNull(intent.getData());
            }
            if (matching) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Localized shortcuts were not updated: " + manager.getDynamicShortcuts());
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(expression, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView responded", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
