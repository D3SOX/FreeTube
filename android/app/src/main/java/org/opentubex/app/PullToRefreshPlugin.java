package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Local Capacitor plugin, licensed under the repository's AGPL-3.0-or-later license. */
@CapacitorPlugin(name = "PullToRefresh")
public class PullToRefreshPlugin extends Plugin {
    private PullToRefreshLayout layout;
    private final Runnable finishTimeout = () -> {
        if (layout != null) currentLayout().setRefreshing(false);
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            layout = (PullToRefreshLayout) getBridge().getWebView().getParent();
            layout.setOnRefreshListener(() -> {
                JSObject context = currentLayout().getRefreshContext();
                if (context == null) {
                    currentLayout().setRefreshing(false);
                    return;
                }
                // A renderer crash must not leave a permanent native spinner.
                layout.removeCallbacks(finishTimeout);
                layout.postDelayed(finishTimeout, 60000);
                notifyListeners("refresh", context);
            });
        });
    }

    private PullToRefreshLayout currentLayout() {
        // Native playback temporarily hosts the WebView in its own refresh layout.
        android.view.ViewParent parent = getBridge().getWebView().getParent();
        return parent instanceof PullToRefreshLayout ? (PullToRefreshLayout) parent : layout;
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            layout.configure(getBridge().getWebView(), call.getBoolean("enabled", false));
            if (currentLayout() != layout) {
                currentLayout().configure(getBridge().getWebView(), call.getBoolean("enabled", false));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            layout.removeCallbacks(finishTimeout);
            currentLayout().setRefreshing(false);
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        if (layout != null) {
            layout.removeCallbacks(finishTimeout);
            currentLayout().setRefreshing(false);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (layout != null) {
            layout.removeCallbacks(finishTimeout);
            layout.configure(getBridge().getWebView(), false);
            layout.setOnRefreshListener(null);
            if (currentLayout() != layout) {
                currentLayout().configure(getBridge().getWebView(), false);
                currentLayout().setOnRefreshListener(null);
            }
        }
    }
}
