package org.opentubex.app;

import android.content.Context;
import android.net.Uri;
import androidx.documentfile.provider.DocumentFile;
import java.io.*;
import android.webkit.MimeTypeMap;
import android.util.AtomicFile;
import java.util.ArrayList;
import java.util.List;

final class YtDlpFiles {
    static byte[] readFile(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) { return read(input, 32 * 1024 * 1024); }
    }
    static void write(File file, byte[] bytes) throws IOException {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream output = atomic.startWrite();
        try {
            output.write(bytes);
            atomic.finishWrite(output);
        } catch (IOException error) {
            atomic.failWrite(output);
            throw error;
        }
    }

    static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IOException("File is too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    static List<File> completedFiles(File root) throws IOException {
        List<File> files = new ArrayList<>();
        collect(root, root, files);
        return files;
    }

    private static void collect(File root, File directory, List<File> files) throws IOException {
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File file : children) {
            if (!file.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) continue;
            if (file.getName().equals("temp")) continue;
            if (file.isDirectory()) collect(root, file, files);
            else if (!file.getName().endsWith(".part") && !file.getName().endsWith(".ytdl")) files.add(file);
        }
    }

    static Uri export(Context context, File root, File file, String folder, String existing, java.util.function.Consumer<Uri> allocated) throws IOException {
        try {
            return exportFile(context, root, file, folder, existing, allocated);
        } catch (InterruptedIOException error) {
            throw error;
        } catch (IOException | SecurityException error) {
            throw new IOException("DOWNLOAD_EXPORT_FAILED", error);
        }
    }

    private static Uri exportFile(Context context, File root, File file, String folder, String existing, java.util.function.Consumer<Uri> allocated) throws IOException {
        DocumentFile directory = DocumentFile.fromTreeUri(context, Uri.parse(folder));
        if (directory == null || !directory.canWrite()) throw new IOException("Download folder is no longer writable");
        String relative = file.getCanonicalPath().substring(root.getCanonicalPath().length() + 1);
        String[] parts = relative.split("/");
        for (int i = 0; i < parts.length - 1; i++) {
            DocumentFile child = directory.findFile(parts[i]);
            if (child == null) child = directory.createDirectory(parts[i]);
            if (child == null || !child.isDirectory()) throw new IOException("Unable to create download directory");
            directory = child;
        }
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.getName().substring(file.getName().lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT));
        DocumentFile destination = existing.isEmpty() ? null : DocumentFile.fromSingleUri(context, Uri.parse(existing));
        if (destination == null || !destination.exists()) destination = directory.createFile(mime == null ? "application/octet-stream" : mime, file.getName());
        if (destination == null) throw new IOException("Unable to create download file");
        allocated.accept(destination.getUri());
        try (InputStream input = new FileInputStream(file);
             OutputStream output = context.getContentResolver().openOutputStream(destination.getUri(), "w")) {
            if (output == null) throw new IOException("Unable to open download file");
            byte[] buffer = new byte[128 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                output.write(buffer, 0, count);
            }
        } catch (IOException error) {
            destination.delete();
            throw error;
        }
        return destination.getUri();
    }

    static boolean exists(Context context, String path) {
        try {
            DocumentFile document = DocumentFile.fromSingleUri(context, Uri.parse(path));
            return document != null && document.exists();
        } catch (Exception error) { return false; }
    }

    static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }
}
