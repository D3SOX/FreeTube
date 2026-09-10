package org.opentubex.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final String PREFIX = "org.opentubex.app.launcher.";

    static List<ActivityInfo> aliases(Context context) throws PackageManager.NameNotFoundException {
        ActivityInfo[] activities = context.getPackageManager().getPackageInfo(
            context.getPackageName(), PackageManager.GET_ACTIVITIES | PackageManager.MATCH_DISABLED_COMPONENTS
        ).activities;
        List<ActivityInfo> result = new ArrayList<>();
        for (ActivityInfo activity : activities) {
            if (activity.name.startsWith(PREFIX) && LauncherActivity.class.getName().equals(activity.targetActivity)) {
                result.add(activity);
            }
        }
        return result;
    }

    static String current(Context context) throws PackageManager.NameNotFoundException {
        PackageManager manager = context.getPackageManager();
        for (ActivityInfo alias : aliases(context)) {
            int state = manager.getComponentEnabledSetting(new ComponentName(context.getPackageName(), alias.name));
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && alias.enabled)) {
                return alias.name.substring(PREFIX.length());
            }
        }
        throw new IllegalStateException("No launcher icon is enabled");
    }

    static void select(Context context, String name) throws PackageManager.NameNotFoundException {
        List<ActivityInfo> aliases = aliases(context);
        String selected = PREFIX + name;
        if (aliases.stream().noneMatch(alias -> alias.name.equals(selected))) {
            throw new IllegalArgumentException("Unknown app icon");
        }
        PackageManager manager = context.getPackageManager();
        ShortcutManager shortcuts = context.getSystemService(ShortcutManager.class);
        List<ShortcutInfo> existing = new ArrayList<>(shortcuts.getDynamicShortcuts());
        for (ShortcutInfo pinned : shortcuts.getPinnedShortcuts()) {
            if (existing.stream().noneMatch(shortcut -> shortcut.getId().equals(pinned.getId()))) existing.add(pinned);
        }
        ComponentName activity = new ComponentName(context.getPackageName(), selected);
        if (!existing.isEmpty()) {
            // Move shortcut ownership before disabling the old launcher. Partial
            // shortcut updates preserve their labels, icons, intents and extras.
            int previousState = manager.getComponentEnabledSetting(activity);
            manager.setComponentEnabledSetting(activity, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            try {
                List<ShortcutInfo> updates = new ArrayList<>();
                for (ShortcutInfo shortcut : existing) {
                    updates.add(new ShortcutInfo.Builder(context, shortcut.getId()).setActivity(activity).build());
                }
                if (!shortcuts.updateShortcuts(updates)) throw new IllegalStateException("Shortcut updates are rate limited");
            } catch (RuntimeException error) {
                manager.setComponentEnabledSetting(activity, previousState, PackageManager.DONT_KILL_APP);
                throw error;
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (ActivityInfo alias : aliases) {
                settings.add(new PackageManager.ComponentEnabledSetting(
                    new ComponentName(context.getPackageName(), alias.name),
                    alias.name.equals(selected) ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                ));
            }
            manager.setComponentEnabledSettings(settings);
        } else {
            // Enable the replacement first so there is always a launchable icon.
            manager.setComponentEnabledSetting(new ComponentName(context.getPackageName(), selected),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (ActivityInfo alias : aliases) {
                if (!alias.name.equals(selected)) {
                    manager.setComponentEnabledSetting(new ComponentName(context.getPackageName(), alias.name),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            }
        }
    }

    @SuppressWarnings("deprecation")
    static void updateTaskIcon(Activity activity) throws PackageManager.NameNotFoundException {
        ActivityInfo alias = activity.getPackageManager().getActivityInfo(
            new ComponentName(activity.getPackageName(), PREFIX + current(activity)), 0);
        String label = activity.getString(R.string.app_name);
        // Launcher3 reads only bitmap task icons; resource IDs fall back to MainActivity's icon.
        int size = activity.getSystemService(ActivityManager.class).getLauncherLargeIconSize();
        Bitmap icon = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Drawable drawable = alias.loadIcon(activity.getPackageManager());
        drawable.setBounds(0, 0, size, size);
        drawable.draw(new Canvas(icon));
        activity.setTaskDescription(new ActivityManager.TaskDescription(label, icon));
    }

    @PluginMethod
    public void getName(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("value", current(getContext()));
            result.put("variant", getContext().getString(R.string.app_icon_variant));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read app icon", error);
        }
    }

    @PluginMethod
    public void change(PluginCall call) {
        try {
            select(getContext(), call.getString("name"));
            getActivity().runOnUiThread(() -> {
                try {
                    updateTaskIcon(getActivity());
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Unable to update recent apps icon", error);
                }
            });
        } catch (Exception error) {
            call.reject("Unable to change app icon", error);
        }
    }
}
