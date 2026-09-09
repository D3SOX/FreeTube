package org.opentubex.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidProxy")
public final class AndroidProxyPlugin extends Plugin {
    @PluginMethod public void getConfiguration(PluginCall call) {
        AndroidProxy.ready().whenComplete((ignored, error) -> {
            if (error != null) call.reject("Android System WebView could not apply the proxy");
            else call.resolve(AndroidProxy.getConfiguration());
        });
    }

    @PluginMethod public void configure(PluginCall call) {
        try {
            AndroidProxy.configure(call.getData());
            AndroidProxy.ready().whenComplete((ignored, error) -> {
                if (error != null) call.reject("Android System WebView could not apply the proxy");
                else call.resolve();
            });
        } catch (Exception error) {
            call.reject("Unable to apply proxy settings", error);
        }
    }
}
