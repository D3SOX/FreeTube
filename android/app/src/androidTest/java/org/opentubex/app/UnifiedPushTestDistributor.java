package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;

/** A protocol peer that exists only in the instrumentation APK. No network service required. */
public class UnifiedPushTestDistributor extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SharedPreferences saved = context.getSharedPreferences("unifiedpush-test", Context.MODE_PRIVATE);
        String action = intent.getAction();
        if ("org.unifiedpush.android.distributor.REGISTER".equals(action)) {
            saved.edit().putString("application", intent.getStringExtra("application"))
                .putString("token", intent.getStringExtra("token")).commit();
            send(context, saved, "NEW_ENDPOINT", new Intent().putExtra("endpoint", "https://push.example.test/first"));
        } else if ("org.opentubex.test.PUSH".equals(action)) {
            Intent extras = new Intent();
            if (intent.hasExtra("payload")) extras.putExtra("bytesMessage", intent.getStringExtra("payload").getBytes(StandardCharsets.UTF_8));
            if (intent.hasExtra("endpoint")) extras.putExtra("endpoint", intent.getStringExtra("endpoint"));
            if (intent.hasExtra("token")) extras.putExtra("token", intent.getStringExtra("token"));
            if (intent.hasExtra("reason")) extras.putExtra("reason", intent.getStringExtra("reason"));
            send(context, saved, intent.getStringExtra("event"), extras);
        }
        // Retain the old token after UNREGISTER so tests can exercise late callbacks.
    }

    private void send(Context context, SharedPreferences saved, String event, Intent extras) {
        String application = saved.getString("application", null);
        if (application == null) return;
        context.sendBroadcast(new Intent("org.unifiedpush.android.connector." + event)
            .setPackage(application).addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
            .putExtra("token", saved.getString("token", "")).putExtras(extras));
    }
}
