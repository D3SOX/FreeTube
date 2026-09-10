package org.opentubex.app;

import android.app.Application;

public final class OpenTubeXApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // The restart process never renders content or makes network requests.
        String processName = null;
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            processName = Application.getProcessName();
        } else {
            android.app.ActivityManager manager = getSystemService(android.app.ActivityManager.class);
            java.util.List<android.app.ActivityManager.RunningAppProcessInfo> processes =
                manager == null ? null : manager.getRunningAppProcesses();
            if (processes != null) {
                for (android.app.ActivityManager.RunningAppProcessInfo process : processes) {
                    if (process.pid == android.os.Process.myPid()) {
                        processName = process.processName;
                        break;
                    }
                }
            }
        }
        if ((getPackageName() + ":restart").equals(processName)) {
            return;
        }
        AndroidProxy.initialize(this);
    }
}
