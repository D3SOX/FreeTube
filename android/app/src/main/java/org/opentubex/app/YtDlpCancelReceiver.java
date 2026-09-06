package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class YtDlpCancelReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            try { YtDlpDownloads.get(context).cancelAll(); }
            catch (Exception error) { android.util.Log.w("OpenTubeXYtDlp", "Unable to cancel downloads", error); }
            finally { result.finish(); }
        }, "yt-dlp-cancel").start();
    }
}
