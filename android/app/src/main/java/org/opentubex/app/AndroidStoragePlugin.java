package org.opentubex.app;

import android.content.Context;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AndroidStorage")
public class AndroidStoragePlugin extends Plugin {
    private volatile boolean pickerOpen;

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        openPicker(call, new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), "directoryChosen");
    }

    @ActivityCallback
    private void directoryChosen(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        try {
            Uri uri = result.getData().getData();
            getContext().getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            call.resolve(new JSObject().put("path", uri.toString()));
        } catch (Exception error) {
            call.reject("Unable to use selected folder", error);
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("fileName", "");
        if (name.isEmpty() || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\") || name.indexOf('\0') >= 0) {
            call.reject("Invalid export filename");
            return;
        }
        if (call.getString("data") == null) {
            call.reject("Missing export data");
            return;
        }
        String directory = call.getString("directory");
        if (directory != null) {
            writeExport(call, null);
            return;
        }
        File staged = null;
        try {
            staged = File.createTempFile("export-", ".tmp", getContext().getCacheDir());
            try (OutputStream output = new FileOutputStream(staged)) {
                output.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            }
            // Capacitor persists the entire call when the picker stops our activity.
            // Keep the bytes on disk so screenshots cannot exceed Binder's state limit.
            call.getData().remove("data");
            call.getData().put("stagedExport", staged.getName());
            if (!openPicker(call, new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(call.getString("mimeType", "application/octet-stream"))
                .putExtra(Intent.EXTRA_TITLE, name), "fileChosen")) {
                staged.delete();
            }
        } catch (Exception error) {
            if (staged != null) staged.delete();
            call.reject("Unable to prepare export file", error);
        }
    }

    private boolean openPicker(PluginCall call, Intent intent, String callbackName) {
        // Capacitor keeps only one activity-result call per plugin, including across picker types.
        if (pickerOpen) {
            call.reject("A file or folder dialog is already open");
            return false;
        }
        pickerOpen = true;
        try {
            startActivityForResult(call, intent, callbackName);
            return true;
        } catch (Exception error) {
            pickerOpen = false;
            call.reject("Unable to open file picker", error);
            return false;
        }
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            stagedExport(call).delete();
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        Uri uri = result.getData().getData();
        getBridge().execute(() -> writeExport(call, uri));
    }

    private void writeExport(PluginCall call, Uri destination) {
        DocumentFile created = null;
        File staged = destination == null ? null : stagedExport(call);
        try {
            if (destination == null) {
                DocumentFile directory = DocumentFile.fromTreeUri(getContext(), Uri.parse(call.getString("directory")));
                if (directory == null || !directory.isDirectory() || !directory.canWrite()) {
                    throw new IOException("Selected folder is no longer writable; choose it again in settings");
                }
                created = directory.createFile(call.getString("mimeType", "application/octet-stream"), call.getString("fileName"));
                if (created == null) throw new IOException("Unable to create export file");
                destination = created.getUri();
            }
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Unable to open export file");
                if (staged == null) {
                    output.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
                } else {
                    try (FileInputStream input = new FileInputStream(staged)) {
                        byte[] buffer = new byte[8192];
                        int length;
                        while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                    }
                }
            }
            call.resolve(new JSObject().put("saved", true).put("uri", destination.toString()));
        } catch (Exception error) {
            if (created != null) {
                try { created.delete(); } catch (Exception ignored) { /* Preserve the write error. */ }
            }
            call.reject("Unable to save file: " + error.getMessage(), error);
        } finally {
            if (staged != null) staged.delete();
        }
    }

    private File stagedExport(PluginCall call) {
        return new File(getContext().getCacheDir(), call.getString("stagedExport"));
    }

    @PluginMethod
    public void getUsage(PluginCall call) {
        AndroidStorage.Usage usage = getUsage(getContext());
        JSObject result = new JSObject();
        result.put("appDataBytes", usage.appDataBytes);
        result.put("cacheBytes", usage.cacheBytes);
        result.put("totalBytes", usage.totalBytes());
        call.resolve(result);
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        CountDownLatch webViewCacheCleared = new CountDownLatch(1);

        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().clearCache(true);
            webViewCacheCleared.countDown();
        });

        try {
            if (!webViewCacheCleared.await(5, TimeUnit.SECONDS)) {
                call.reject("Timed out while clearing the WebView cache");
                return;
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            call.reject("Interrupted while clearing the WebView cache", error);
            return;
        }

        boolean cleared = clearCacheFiles(getContext());

        JSObject result = new JSObject();
        result.put("cleared", cleared);
        call.resolve(result);
    }

    static AndroidStorage.Usage getUsage(Context context) {
        return AndroidStorage.measure(context.getDataDir(), cacheDirectories(context));
    }

    static boolean clearCacheFiles(Context context) {
        synchronized (YtDlpPlugin.PLAYBACK_CACHE_LOCK) {
            boolean cleared = true;
            for (File directory : cacheDirectories(context)) cleared &= AndroidStorage.clearDirectory(directory);
            return cleared;
        }
    }

    private static File[] cacheDirectories(Context context) {
        return new File[] {
            context.getCacheDir(),
            context.getCodeCacheDir(),
            YtDlpPlugin.playbackCacheDirectory(context)
        };
    }
}
