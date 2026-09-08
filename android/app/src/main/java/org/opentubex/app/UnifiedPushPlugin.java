package org.opentubex.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.PersistableBundle;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import org.unifiedpush.android.connector.UnifiedPush;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "UnifiedPush")
public class UnifiedPushPlugin extends Plugin {
    private BroadcastReceiver receiver;

    private static String action(Context context) { return context.getPackageName() + ".UNIFIED_PUSH_STATE"; }

    static void stateChanged(Context context) {
        context.sendBroadcast(new Intent(action(context)).setPackage(context.getPackageName()));
    }

    @Override public void load() {
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                notifyListeners("stateChanged", new JSObject());
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(action(getContext())), ContextCompat.RECEIVER_NOT_EXPORTED);
        synchronized (UnifiedPushState.LOCK) {
            JSONObject state = UnifiedPushState.read(getContext());
            if (state.optBoolean("enabled") && UnifiedPush.getSavedDistributor(getContext()) != null) {
                try {
                    // The connector owns provider migrations and temporary fallbacks.
                    // Only an explicit user selection may change its distributor.
                    UnifiedPush.register(getContext(), state.getString("instance"), "OpenTubeX", nullableVapid(state));
                } catch (Exception ignored) {
                    registrationFailed();
                }
            }
        }
    }

    @Override protected void handleOnDestroy() {
        if (receiver != null) getContext().unregisterReceiver(receiver);
        super.handleOnDestroy();
    }

    @PluginMethod public void getState(PluginCall call) {
        synchronized (UnifiedPushState.LOCK) {
            try {
                JSONObject state = UnifiedPushState.read(getContext());
                List<String> available = UnifiedPush.getDistributors(getContext());
                JSArray distributors = new JSArray();
                PackageManager pm = getContext().getPackageManager();
                for (String name : available) {
                    String label;
                    try { label = pm.getApplicationLabel(pm.getApplicationInfo(name, 0)).toString(); }
                    catch (PackageManager.NameNotFoundException ignored) { label = name; }
                    distributors.put(new JSObject().put("id", name).put("name", label));
                }
                boolean enabled = state.optBoolean("enabled");
                String selected = enabled ? UnifiedPush.getSavedDistributor(getContext()) : null;
                String distributor = selected != null ? selected : state.optString("distributor");
                String status = enabled ? state.optString("status", "registering") : "disabled";
                if (enabled && selected == null) {
                    status = "unavailable";
                    state.remove("subscription");
                    state.put("status", status);
                    UnifiedPushState.write(getContext(), state);
                }
                call.resolve(new JSObject().put("enabled", enabled).put("status", status)
                    .put("distributor", distributor).put("distributors", distributors)
                    .put("vapid", state.optString("vapid")).put("error", state.optString("error"))
                    .put("hasSubscription", state.has("subscription"))
                    .put("notificationsAllowed", NotificationManagerCompat.from(getContext()).areNotificationsEnabled()));
            } catch (Exception error) { call.reject("Unable to read UnifiedPush state"); }
        }
    }

    @PluginMethod public void register(PluginCall call) {
        synchronized (UnifiedPushState.LOCK) {
            String distributor = call.getString("distributor", "");
            String vapid = call.getString("vapid", "").trim();
            if (!UnifiedPush.getDistributors(getContext()).contains(distributor)) {
                call.reject("Choose an installed UnifiedPush distributor");
                return;
            }
            if (!vapid.isEmpty() && !vapid.matches("[A-Za-z0-9_-]{87}")) {
                call.reject("Invalid VAPID public key");
                return;
            }
            if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
                call.reject("Notifications are disabled in Android settings");
                return;
            }
            try {
                JSONObject previous = UnifiedPushState.read(getContext());
                boolean reuse = previous.optBoolean("enabled") && distributor.equals(UnifiedPush.getSavedDistributor(getContext()))
                    && vapid.equals(previous.optString("vapid")) && !previous.optString("instance").isEmpty();
                if (!reuse) UnifiedPush.removeDistributor(getContext());
                JSONObject state = (reuse ? previous : new JSONObject()).put("enabled", true).put("status", "registering")
                    .put("distributor", distributor).put("vapid", vapid)
                    .put("instance", reuse ? previous.getString("instance") : UUID.randomUUID().toString());
                state.remove("error");
                UnifiedPushState.write(getContext(), state);
                UnifiedPush.saveDistributor(getContext(), distributor);
                UnifiedPush.register(getContext(), state.getString("instance"), "OpenTubeX", nullableVapid(state));
                call.resolve();
                stateChanged(getContext());
            } catch (Exception error) {
                registrationFailed();
                call.reject("Unable to register with UnifiedPush");
            }
        }
    }

    @PluginMethod public void unregister(PluginCall call) {
        synchronized (UnifiedPushState.LOCK) {
            try {
                // Invalidate callbacks before asking the distributor to unregister.
                UnifiedPushState.write(getContext(), new JSONObject());
                UnifiedPush.removeDistributor(getContext());
                getContext().getSystemService(NotificationManager.class).cancel(UnifiedPushService.NOTIFICATION_ID);
                stateChanged(getContext());
                call.resolve();
            } catch (Exception error) { call.reject("Unable to unregister UnifiedPush"); }
        }
    }

    @PluginMethod public void getSubscription(PluginCall call) {
        synchronized (UnifiedPushState.LOCK) {
            JSONObject subscription = currentSubscription();
            if (subscription == null) call.reject("No UnifiedPush subscription available");
            else call.resolve(new JSObject().put("subscription", subscription));
        }
    }

    @PluginMethod public void copySubscription(PluginCall call) {
        synchronized (UnifiedPushState.LOCK) {
            JSONObject subscription = currentSubscription();
            if (subscription == null) { call.reject("No UnifiedPush subscription available"); return; }
            ClipData clip = ClipData.newPlainText("UnifiedPush", subscription.toString());
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
            getContext().getSystemService(ClipboardManager.class).setPrimaryClip(clip);
            call.resolve();
        }
    }

    private JSONObject currentSubscription() {
        JSONObject state = UnifiedPushState.read(getContext());
        if (!state.optBoolean("enabled") || UnifiedPush.getAckDistributor(getContext()) == null) return null;
        return state.optJSONObject("subscription");
    }

    private void registrationFailed() {
        try {
            JSONObject state = UnifiedPushState.read(getContext());
            state.put("status", "error");
            state.remove("subscription");
            UnifiedPushState.write(getContext(), state);
            stateChanged(getContext());
        } catch (Exception ignored) {
            // State read failures default to disabled. Never log connection details.
        }
    }

    private static String nullableVapid(JSONObject state) {
        String vapid = state.optString("vapid");
        return vapid.isEmpty() ? null : vapid;
    }
}
