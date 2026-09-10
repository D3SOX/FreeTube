package org.opentubex.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

/** Runs separately so restarting also terminates the main app process. */
public final class RestartActivity extends Activity {
    static final String EXTRA_PROCESS_ID = "processId";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int originalPid = getIntent().getIntExtra(EXTRA_PROCESS_ID, -1);
        if (originalPid > 0 && originalPid != Process.myPid()) {
            Process.killProcess(originalPid);
            startActivity(Intent.makeRestartActivityTask(new ComponentName(this, MainActivity.class)));
        }
        finishAndRemoveTask();
        Process.killProcess(Process.myPid());
    }
}
