package org.opentubex.app;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** An empty test-only document tree: instrumentation never writes to the user's folders. */
public final class YtDlpTestDocumentsProvider extends DocumentsProvider {
    static final String AUTHORITY = "org.opentubex.app.nightly.test.documents";
    private File root;
    private static final String[] COLUMNS = {"document_id", "_display_name", "mime_type", "flags", "_size", "last_modified"};

    @Override public boolean onCreate() {
        root = new File(getContext().getCacheDir(), "yt-dlp-documents");
        root.mkdirs();
        return true;
    }
    public static final class GrantReceiver extends android.content.BroadcastReceiver {
        @Override public void onReceive(android.content.Context context, android.content.Intent intent) {
            android.net.Uri uri = android.net.Uri.parse(intent.getStringExtra("uri"));
            if (!AUTHORITY.equals(uri.getAuthority())) return;
            context.grantUriPermission("org.opentubex.app.nightly", uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION | android.content.Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        }
    }
    private File file(String id) throws FileNotFoundException {
        try {
            File file = id.equals("root") ? root : new File(root, id);
            if (!file.getCanonicalPath().equals(root.getCanonicalPath()) && !file.getCanonicalPath().startsWith(root.getCanonicalPath() + "/")) throw new IOException();
            return file;
        } catch (IOException error) { throw new FileNotFoundException(); }
    }
    private void row(MatrixCursor cursor, File file) {
        String id = file.equals(root) ? "root" : root.toURI().relativize(file.toURI()).getPath().replaceAll("/$", "");
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : cursor.getColumnNames()) {
            switch (column) {
                case "document_id": row.add(id); break;
                case "_display_name": row.add(file.getName()); break;
                case "mime_type": row.add(file.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR : "video/webm"); break;
                case "flags": row.add(DocumentsContract.Document.FLAG_SUPPORTS_WRITE | DocumentsContract.Document.FLAG_SUPPORTS_DELETE | DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE); break;
                case "_size": row.add(file.length()); break;
                case "last_modified": row.add(file.lastModified()); break;
                default: row.add(null);
            }
        }
    }
    @Override public Cursor queryRoots(String[] projection) { return new MatrixCursor(projection == null ? new String[]{"root_id"} : projection); }
    @Override public Cursor queryDocument(String id, String[] projection) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection);
        File file = file(id);
        if (file.exists()) row(cursor, file);
        return cursor;
    }
    @Override public Cursor queryChildDocuments(String id, String[] projection, String sort) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection);
        File[] children = file(id).listFiles();
        if (children != null) for (File child : children) row(cursor, child);
        return cursor;
    }
    @Override public String createDocument(String parent, String mime, String name) throws FileNotFoundException {
        File directory = file(parent);
        File child = new File(directory, name);
        int number = 0;
        while (child.exists()) child = new File(directory, (++number) + "-" + name);
        try {
            if (mime.equals(DocumentsContract.Document.MIME_TYPE_DIR)) child.mkdirs();
            else child.createNewFile();
            return root.toURI().relativize(child.toURI()).getPath().replaceAll("/$", "");
        } catch (IOException error) { throw new FileNotFoundException(error.getMessage()); }
    }
    @Override public ParcelFileDescriptor openDocument(String id, String mode, CancellationSignal signal) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(id), ParcelFileDescriptor.parseMode(mode));
    }
    @Override public void deleteDocument(String id) throws FileNotFoundException { delete(file(id)); }
    private void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }
    @Override public boolean isChildDocument(String parent, String child) {
        try { return file(child).getAbsolutePath().startsWith(file(parent).getAbsolutePath() + "/"); }
        catch (FileNotFoundException error) { return false; }
    }
}
