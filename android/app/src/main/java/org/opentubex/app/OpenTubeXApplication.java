package org.opentubex.app;

import android.app.Application;

public final class OpenTubeXApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        AndroidProxy.initialize(this);
    }
}
