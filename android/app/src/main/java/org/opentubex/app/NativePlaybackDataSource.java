package org.opentubex.app;

import android.net.Uri;

import androidx.media3.common.C;
import androidx.media3.datasource.BaseDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;

import java.io.IOException;

/** Adapts a SABR segment supplied by the renderer to Media3's extractor input. */
final class NativePlaybackDataSource extends BaseDataSource {
    interface Segments {
        byte[] read(Uri uri, long position, long length) throws IOException;
    }

    private final Segments segments;
    private byte[] data;
    private int offset;
    private Uri uri;
    private boolean opened;

    static DataSource.Factory factory(DataSource.Factory fallback, Segments segments) {
        return () -> new DataSource() {
            private DataSource current;
            private final java.util.List<androidx.media3.datasource.TransferListener> listeners =
                new java.util.ArrayList<>();

            @Override public void addTransferListener(androidx.media3.datasource.TransferListener listener) {
                listeners.add(listener);
            }

            @Override public long open(DataSpec spec) throws IOException {
                current = "otxsabr".equals(spec.uri.getScheme())
                    ? new NativePlaybackDataSource(segments) : fallback.createDataSource();
                for (androidx.media3.datasource.TransferListener listener : listeners) {
                    current.addTransferListener(listener);
                }
                return current.open(spec);
            }

            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                if (current == null) throw new IOException("Data source is not open");
                return current.read(buffer, offset, length);
            }

            @Override public Uri getUri() { return current == null ? null : current.getUri(); }
            @Override public java.util.Map<String, java.util.List<String>> getResponseHeaders() {
                return current == null ? java.util.Collections.emptyMap() : current.getResponseHeaders();
            }

            @Override public void close() throws IOException {
                if (current != null) {
                    try { current.close(); } finally { current = null; }
                }
            }
        };
    }

    private NativePlaybackDataSource(Segments segments) {
        super(true);
        this.segments = segments;
    }

    @Override public long open(DataSpec spec) throws IOException {
        transferInitializing(spec);
        opened = true;
        transferStarted(spec);
        data = segments.read(spec.uri, spec.position, spec.length);
        offset = 0;
        uri = spec.uri;
        return data.length;
    }

    @Override public int read(byte[] buffer, int bufferOffset, int length) throws IOException {
        if (data == null) throw new IOException("SABR segment is not open");
        if (length == 0) return 0;
        if (offset == data.length) return C.RESULT_END_OF_INPUT;
        int count = Math.min(length, data.length - offset);
        System.arraycopy(data, offset, buffer, bufferOffset, count);
        offset += count;
        bytesTransferred(count);
        return count;
    }

    @Override public Uri getUri() { return uri; }

    @Override public void close() {
        if (opened) transferEnded();
        opened = false;
        data = null;
        uri = null;
    }
}
