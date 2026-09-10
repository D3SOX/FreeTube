package org.opentubex.app;

import android.app.Application;

public final class OpenTubeXApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // The restart process never renders content or makes network requests.
        android.app.ActivityManager manager = getSystemService(android.app.ActivityManager.class);
        for (android.app.ActivityManager.RunningAppProcessInfo process : manager.getRunningAppProcesses()) {
            if (process.pid == android.os.Process.myPid() && process.processName.equals(getPackageName() + ":restart")) {
                return;
            }
        }
        AndroidProxy.initialize(this);
    }
}
