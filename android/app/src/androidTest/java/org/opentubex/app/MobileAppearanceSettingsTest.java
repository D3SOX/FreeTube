package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MobileAppearanceSettingsTest {
    @Test
    public void bottomNavigationFollowsPageScrollAtDifferentScales() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            // First-run tutorial makes the navigation inert and locks native scrolling.
            awaitCondition(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(view, "!document.querySelector('.tutorialOverlay')");
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const content = document.createElement('div');
                        content.id = 'mobile-navigation-scroll-fixture';
                        content.style.height = '4000px';
                        document.querySelector('.routerView').append(content);
                    })()
                    """);
                for (int scale : new int[] {100, 125, 150}) {
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', " + scale + ")");
                    awaitCondition(view, "Math.abs(window.visualViewport.scale - " + scale / 100.0 + ") < 0.01");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "window.scrollY === 0 && !document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('#mobile-navigation-scroll-fixture').dispatchEvent(new Event('scroll'))");
                    assertEquals("Nested scrolling leaves the navigation visible", "true", evaluate(view,
                        "!document.querySelector('.sideNav').classList.contains('scrollHidden')"));
                    evaluate(view, "window.__navigationPageHeight = document.scrollingElement.scrollHeight; window.scrollTo(0, 400)");
                    awaitCondition(view, "document.querySelector('.sideNav').getBoundingClientRect().top >= window.innerHeight - 1");
                    assertEquals("Hiding keeps the page height and scroll position stable", "true", evaluate(view,
                        "document.scrollingElement.scrollHeight === window.__navigationPageHeight && Math.abs(window.scrollY - 400) <= 1"));
                    evaluate(view, "window.scrollTo(0, 360)");
                    awaitCondition(view, """
                        (() => {
                            const nav = document.querySelector('.sideNav');
                            const rect = nav.getBoundingClientRect();
                            return !nav.classList.contains('scrollHidden') && rect.top < window.innerHeight - 40 &&
                                Math.abs(rect.bottom - window.innerHeight) <= 1;
                        })()
                        """);
                    evaluate(view, "window.scrollTo(0, 600)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('.sideNav .navOption').focus({ preventScroll: true })");
                    assertEquals("Navigation receives keyboard focus: " + evaluate(view,
                        "JSON.stringify({ active: document.activeElement.outerHTML, inert: document.querySelector('.sideNav').inert, prompts: document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen })"),
                        "true", evaluate(view, "document.activeElement === document.querySelector('.sideNav .navOption')"));
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.activeElement.blur(); window.scrollTo(0, 800)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                }
                evaluate(view, "window.scrollTo(0, 400)");
                awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                awaitCondition(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/userplaylists' && !document.querySelector('.sideNav').classList.contains('scrollHidden')");
            } finally {
                evaluate(view, "document.querySelector('#mobile-navigation-scroll-fixture')?.remove(); delete window.__navigationPageHeight; window.scrollTo(0, 0)");
                restore(view);
            }
        }
    }

    private static final String SCROLL_STATE = """
        (() => {
            const viewport = document.querySelector('.quickSettingsMenu .quickSettingsScroll');
            const content = viewport.querySelector('.quickSettingsContent');
            const contentEnd = content.getBoundingClientRect().bottom -
                viewport.getBoundingClientRect().top - viewport.clientTop + viewport.scrollTop +
                (parseFloat(getComputedStyle(viewport).paddingBottom) || 0);
            const range = Math.max(0, contentEnd - viewport.clientHeight);
            const scrollbar = viewport.querySelector('.os-scrollbar-vertical');
            const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect();
            const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect();
            const overflow = range > 1;
            return {
                range, offset: viewport.scrollTop,
                atEnd: Math.abs(viewport.scrollTop - range) <= 1,
                scrollbarMatches: overflow
                    ? scrollbar.classList.contains('os-scrollbar-visible') &&
                        Math.abs(thumb.height - track.height * viewport.clientHeight / contentEnd) <= 2 &&
                        Math.abs(thumb.bottom - track.bottom) <= 2
                    : !scrollbar.classList.contains('os-scrollbar-visible') ||
                        scrollbar.classList.contains('os-scrollbar-unusable')
            };
        })()
        """;

    @Test
    public void enlargedPhoneHeaderKeepsBackAndBothShortcutsWithinViewport() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                awaitCondition(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/userplaylists'");
                awaitCondition(view, "!!document.querySelector('.topNav .downloadsButton') && !!document.querySelector('.topNav .settingsButton')");
                awaitCondition(view, """
                    (() => {
                        const viewport = window.visualViewport;
                        const visible = element => {
                            const rect = element.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 &&
                                getComputedStyle(element).visibility !== 'hidden';
                        };
                        const back = document.querySelector('.navBackButton');
                        if (!back || !visible(back)) return false;
                        const buttons = [...document.querySelectorAll('.topNav button')].filter(visible);
                        return buttons.length > 0 && buttons.every(button => {
                            const rect = button.getBoundingClientRect();
                            return rect.left >= viewport.offsetLeft - 1 &&
                                rect.right <= viewport.offsetLeft + viewport.width + 1 &&
                                rect.top >= viewport.offsetTop - 1 &&
                                rect.bottom <= viewport.offsetTop + viewport.height + 1;
                        });
                    })()
                    """);
                String route = "document.querySelector('#app').__vue_app__.config.globalProperties.$route.fullPath";
                String backDisabled = "document.querySelector('.navBackButton button').getAttribute('aria-disabled') === 'true'";
                String expectedForwardRoute = null;
                for (int entry = 0; entry < 10 && !"true".equals(evaluate(view, backDisabled)); entry++) {
                    expectedForwardRoute = evaluate(view, route);
                    assertTrue("Back remains visible while navigating history", "true".equals(evaluate(view,
                        "document.querySelector('.navBackButton button').getBoundingClientRect().width > 0")));
                    evaluate(view, "document.querySelector('.navBackButton button').click()");
                    awaitCondition(view, route + " !== " + expectedForwardRoute + " || " + backDisabled);
                }
                assertEquals("Back is disabled at the earliest history entry", "true", evaluate(view, backDisabled));
                assertTrue("The fixture has a forward history entry", expectedForwardRoute != null);
                awaitCondition(view, """
                    (() => {
                        const forward = document.querySelector('.navForwardButton button');
                        const rect = forward.getBoundingClientRect();
                        const viewport = window.visualViewport;
                        return forward.getAttribute('aria-disabled') === 'false' && rect.width > 0 &&
                            rect.left >= viewport.offsetLeft - 1 &&
                            rect.right <= viewport.offsetLeft + viewport.width + 1;
                    })()
                    """);
                evaluate(view, "document.querySelector('.navForwardButton button').click()");
                awaitCondition(view, route + " === " + expectedForwardRoute);
            } finally {
                restore(view);
            }
        }
    }

    @Test
    public void reducingScaleClampsQuickSettingsAndUpdatesRenderedScrollbar() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, "document.querySelector('.profileTrigger').click()");
                awaitCondition(view, "!!document.querySelector('.quickSettingsContent') && !!document.querySelector('.quickSettingsScroll .os-scrollbar-handle')");
                evaluate(view, """
                    (() => {
                        const viewport = document.querySelector('.quickSettingsScroll');
                        viewport.scrollTop = viewport.scrollHeight;
                    })()
                    """);
                awaitCondition(view, "(() => { const state = " + SCROLL_STATE + "; return state.offset > 0 && state.atEnd && state.scrollbarMatches; })()");
                JSONObject before = json(view, SCROLL_STATE);
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', 75)");
                awaitCondition(view, "Math.abs(window.visualViewport.scale - 0.75) < 0.01");
                awaitCondition(view, "(() => { const state = " + SCROLL_STATE + "; return state.atEnd && state.scrollbarMatches; })()");
                JSONObject after = json(view, SCROLL_STATE);
                assertTrue("Reducing scale grows the viewport and shortens its scroll range: " + before + " -> " + after,
                    after.getDouble("range") < before.getDouble("range") - 1);
            } finally {
                restore(view);
            }
        }
    }

    private static WebView webView(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<WebView> view = new AtomicReference<>();
        scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
        awaitCondition(view.get(), "!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store && !!document.querySelector('.profileTrigger')");
        return view.get();
    }

    private static void prepare(WebView view) throws Exception {
        evaluate(view, """
            (() => {
                const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                const values = {
                    UiScale: 150, CapacitorLayoutMode: 'phone', EnableDownloads: true,
                    MoveDownloadsToAppHeader: true, MoveSettingsToAppHeader: true,
                    HideHeaderLogo: false, AlwaysShowScrollbars: true,
                    FetchSubscriptionsAutomatically: false,
                    QuickSettings: ['baseTheme', 'mainColor', 'uiScale', 'thumbnailSize',
                        'defaultQuality', 'defaultPlayback', 'playNextVideo',
                        'enableSubtitlesByDefault', 'listType', 'playlistViewType',
                        'hideRecommendedVideos', 'hideComments', 'currentLocale', 'region']
                };
                window.__mobileAppearanceSaved = Object.fromEntries(Object.keys(values).map(
                    key => [key, structuredClone(app.$store.getters['get' + key])]
                ));
                for (const [key, value] of Object.entries(values)) app.$store.commit('set' + key, value);
                // Keep first-run UI out of the measured header without changing tutorial progress.
                const style = document.createElement('style');
                style.id = 'mobile-appearance-test-style';
                style.textContent = '.tutorialOverlay { display: none !important; }';
                document.head.append(style);
                app.$router.push('/history');
            })()
            """);
        awaitCondition(view, "Math.abs(window.visualViewport.scale - 1.5) < 0.01 && document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/history'");
        assertTrue("Run this regression on a portrait phone with at most 440 CSS pixels at 100% scale",
            "true".equals(evaluate(view, "window.visualViewport.width * window.visualViewport.scale <= 440")));
    }

    private static void restore(WebView view) throws Exception {
        evaluate(view, """
            (() => {
                document.querySelector('.profileTrigger[aria-expanded="true"]')?.click();
                const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                for (const [key, value] of Object.entries(window.__mobileAppearanceSaved ?? {})) {
                    store.commit('set' + key, value);
                }
                delete window.__mobileAppearanceSaved;
                document.querySelector('#mobile-appearance-test-style')?.remove();
            })()
            """);
    }

    private static JSONObject json(WebView view, String expression) throws Exception {
        return new JSONObject((String) new JSONTokener(evaluate(view, "JSON.stringify(" + expression + ")")).nextValue());
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script, "true", evaluate(view, script));
    }
}
