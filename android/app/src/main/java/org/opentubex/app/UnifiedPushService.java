package org.opentubex.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.UnifiedPush;
import org.unifiedpush.android.connector.data.PublicKeySet;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

/** Runs independently of the Activity/WebView, including when the app is closed. */
public class UnifiedPushService extends PushService {
    static final String CHANNEL_ID = "unifiedpush";
    static final int NOTIFICATION_ID = 0x55505553;

    interface StateUpdate { void apply(JSONObject state) throws Exception; }

    private void update(String instance, StateUpdate update) {
        synchronized (UnifiedPushState.LOCK) {
            JSONObject state = UnifiedPushState.read(this);
            if (!UnifiedPushState.accepts(state, instance)) return;
            try {
                update.apply(state);
                UnifiedPushState.write(this, state);
                UnifiedPushPlugin.stateChanged(this);
            } catch (Exception error) {
                // Exceptions can contain endpoint URLs or payloads. Do not log them.
                Log.w("OpenTubeXUnifiedPush", "Unable to save UnifiedPush state");
            }
        }
    }

    @Override public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        update(instance, state -> {
            Uri uri = Uri.parse(endpoint.getUrl());
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) {
                state.remove("subscription");
                state.put("status", "error");
                return;
            }
            JSONObject subscription = new JSONObject().put("endpoint", endpoint.getUrl());
            PublicKeySet keys = endpoint.getPubKeySet();
            if (keys != null) subscription.put("keys", new JSONObject()
                .put("p256dh", keys.getPubKey()).put("auth", keys.getAuth()));
            state.put("subscription", subscription);
            state.put("distributor", UnifiedPush.getSavedDistributor(this));
            state.put("status", "registered");
            state.remove("error");
        });
    }

    @Override public void onRegistrationFailed(FailedReason reason, String instance) {
        update(instance, state -> {
            state.remove("subscription");
            state.put("status", "error");
            state.put("error", reason.name());
        });
    }

    @Override public void onUnregistered(String instance) {
        update(instance, state -> {
            state.remove("subscription");
            state.put("status", "unregistered");
        });
    }

    @Override public void onTempUnavailable(String instance) {
        update(instance, state -> state.put("status", "unavailable"));
    }

    @Override public void onMessage(PushMessage message, String instance) {
        synchronized (UnifiedPushState.LOCK) {
            if (!UnifiedPushState.accepts(UnifiedPushState.read(this), instance)) return;
            try {
                UnifiedPushPayload payload = UnifiedPushPayload.parse(message.getContent());
                if (NotificationManagerCompat.from(this).areNotificationsEnabled()) {
                    getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(this, payload));
                }
            } catch (Exception error) {
                Log.w("OpenTubeXUnifiedPush", "Ignored invalid or undeliverable push notification");
            }
        }
    }

    static Notification notification(Context context, UnifiedPushPayload payload) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "UnifiedPush", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (!payload.videoId.isEmpty()) {
            open.setAction(Intent.ACTION_VIEW);
            open.setData(Uri.parse("https://www.youtube.com/watch?v=" + payload.videoId));
        }
        PendingIntent action = PendingIntent.getActivity(context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_opentubex)
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setStyle(new Notification.BigTextStyle().bigText(payload.body))
            .setContentIntent(action)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build();
    }
}
