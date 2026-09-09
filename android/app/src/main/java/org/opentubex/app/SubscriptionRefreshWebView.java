package org.opentubex.app;

import android.content.Context;
import android.util.AttributeSet;

import com.getcapacitor.CapacitorWebView;

/** Keep an active renderer refresh out of Chromium's hidden-page freezer. */
public final class SubscriptionRefreshWebView extends CapacitorWebView {
    private boolean refreshActive;
    private int actualWindowVisibility = VISIBLE;

    public SubscriptionRefreshWebView(Context context, AttributeSet attributes) {
        super(context, attributes);
        AndroidProxy.protectWebView(this);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        actualWindowVisibility = visibility;
        super.onWindowVisibilityChanged(refreshActive ? VISIBLE : visibility);
    }

    void setRefreshActive(boolean active) {
        refreshActive = active;
        // This changes Chromium's lifecycle, not Android's window visibility.
        // Renderer UI behavior uses the actual activity state via appVisibility.
        super.onWindowVisibilityChanged(active ? VISIBLE : actualWindowVisibility);
    }
}
