package org.opentubex.app;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Device-local registration state must not be restored to another device. */
final class UnifiedPushState {
    static final Object LOCK = new Object();
    private UnifiedPushState() {}

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "unifiedpush.json"));
    }

    static JSONObject read(Context context) {
        try {
            return new JSONObject(new String(file(context).readFully(), StandardCharsets.UTF_8));
        } catch (Exception error) {
            // Missing/corrupt state must never enable a registration by itself.
            return new JSONObject();
        }
    }

    static void write(Context context, JSONObject state) throws Exception {
        AtomicFile file = file(context);
        FileOutputStream output = file.startWrite();
        try {
            output.write(state.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) {
            file.failWrite(output);
            throw error;
        }
    }

    static boolean accepts(JSONObject state, String instance) {
        return state.optBoolean("enabled") && !state.optString("instance").isEmpty()
            && state.optString("instance").equals(instance);
    }
}
