package org.opentubex.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public class YtDlpPluginTest {
    @Test public void cookiePickerWithoutUriResolvesAsCancelled() throws Exception {
        YtDlpPlugin plugin = new YtDlpPlugin();
        CompletableFuture<JSObject> response = new CompletableFuture<>();
        PluginCall call = new PluginCall(null, "YtDlp", "test", "chooseCookies", new JSObject()) {
            @Override public void resolve(JSObject result) { response.complete(result); }
            @Override public void reject(String message) { response.completeExceptionally(new AssertionError(message)); }
        };
        var callback = YtDlpPlugin.class.getDeclaredMethod("cookiesChosen", PluginCall.class, ActivityResult.class);
        callback.setAccessible(true);
        var executor = YtDlpPlugin.class.getDeclaredField("executor");
        executor.setAccessible(true);
        try {
            callback.invoke(plugin, call, new ActivityResult(Activity.RESULT_OK, new Intent()));
            assertEquals(0, response.get(5, TimeUnit.SECONDS).length());
        } finally { ((ExecutorService) executor.get(plugin)).shutdownNow(); }
    }
}
