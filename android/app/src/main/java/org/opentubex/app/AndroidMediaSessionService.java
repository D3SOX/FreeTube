package org.opentubex.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AndroidMediaSessionService extends Service {
    private static java.lang.ref.WeakReference<AndroidMediaSessionService> activeService = new java.lang.ref.WeakReference<>(null);
    static final String ACTION_UPDATE = "org.opentubex.app.media.UPDATE";
    static final String EXTRA_STATE = "state";

    private static final String ACTION_CONTROL_PREFIX = "org.opentubex.app.media.CONTROL.";
    private static final String CHANNEL_ID = OpenTubeXNotificationChannels.MEDIA_PLAYBACK_ID;
    private static final int NOTIFICATION_ID = 0x4d454449;
    private static final double DEFAULT_SEEK_SECONDS = 10;
    private static final int MAX_ARTWORK_REDIRECTS = 5;
    static final int MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
    static final int MAX_ARTWORK_DIMENSION = 2048;
    static final long MAX_ARTWORK_PIXELS = 2048L * 2048L;
    static final long MAX_ARTWORK_DECODED_BYTES = MAX_ARTWORK_PIXELS * 4L;
    private static final long PAUSED_WAKE_LOCK_GRACE_MS = 15_000;

    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private PowerManager.WakeLock playbackWakeLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable releasePlaybackWakeLock = () -> {
        if (playbackWakeLock != null && playbackWakeLock.isHeld()) playbackWakeLock.release();
    };
    private MediaSession mediaSession;
    private JSONObject currentState;
    private Bitmap artwork;
    private String artworkUrl = "";
    private String metadataSignature = "";
    private String notificationSignature = "";

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = new java.lang.ref.WeakReference<>(this);
        OpenTubeXNotificationChannels.createAll(this);
        mediaSession = new MediaSession(this, "OpenTubeX");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        playbackWakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            getPackageName() + ":media-playback"
        );
        playbackWakeLock.setReferenceCounted(false);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.PLAY);
            }

            @Override
            public void onPause() {
                AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.PAUSE);
            }

            @Override
            public void onStop() {
                AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.STOP);
            }

            @Override
            public void onSkipToPrevious() {
                AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.PREVIOUS);
            }

            @Override
            public void onSkipToNext() {
                AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.NEXT);
            }

            @Override
            public void onSeekTo(long positionMs) {
                AndroidMediaSessionPlugin.emitAction(
                    AndroidMediaActions.SEEK_TO,
                    positionMs / 1000.0,
                    null
                );
            }

            @Override
            public void onRewind() {
                AndroidMediaSessionPlugin.emitAction(
                    AndroidMediaActions.SEEK_BACKWARD,
                    null,
                    DEFAULT_SEEK_SECONDS
                );
            }

            @Override
            public void onFastForward() {
                AndroidMediaSessionPlugin.emitAction(
                    AndroidMediaActions.SEEK_FORWARD,
                    null,
                    DEFAULT_SEEK_SECONDS
                );
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action != null && action.startsWith(ACTION_CONTROL_PREFIX)) {
            dispatchNotificationAction(action.substring(ACTION_CONTROL_PREFIX.length()));
            return START_NOT_STICKY;
        }

        String serializedState = intent == null ? null : intent.getStringExtra(EXTRA_STATE);
        if (!ACTION_UPDATE.equals(action) || serializedState == null) {
            stopPlaybackService();
            return START_NOT_STICKY;
        }

        try {
            JSONObject nextState = new JSONObject(serializedState);
            if (!AndroidPlaybackPlugin.acceptsMediaOwner(nextState.optString("nativeOwner", ""))) {
                if (currentState == null) stopSelf(startId);
                else applyState(currentState, true);
                return START_NOT_STICKY;
            }
            currentState = nextState;
            mediaSession.setActive(true);
            applyState(currentState, true);
        } catch (JSONException error) {
            stopPlaybackService();
        }
        return START_NOT_STICKY;
    }

    private void applyState(JSONObject state) {
        applyState(state, false);
    }

    private void applyState(JSONObject state, boolean foregroundStart) {
        String playbackState = state.optString("playbackState", "none");
        if ("none".equals(playbackState)) {
            stopPlaybackService();
            return;
        }

        Set<String> actions = readActions(state.optJSONArray("actions"));
        AndroidPlaybackPlugin.updateQueueActions(state.optString("nativeOwner", ""), actions);
        long durationMs = secondsToMillis(state.optDouble("duration", 0));
        long positionMs = Math.min(durationMs, secondsToMillis(state.optDouble("position", 0)));
        float playbackRate = (float) Math.max(0, state.optDouble("playbackRate", 1));
        loadArtwork(state.optString("artwork", ""));

        String nextMetadataSignature = AndroidMediaNotificationState.metadataSignature(
            state.optString("title", ""),
            state.optString("artist", ""),
            durationMs,
            artworkUrl,
            artwork != null
        );
        if (!nextMetadataSignature.equals(metadataSignature)) {
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, state.optString("title", ""))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, state.optString("artist", ""))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
            if (artwork != null) {
                metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
                metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
            }
            mediaSession.setMetadata(metadata.build());
            metadataSignature = nextMetadataSignature;
        }

        int nativeState = "playing".equals(playbackState)
            ? PlaybackState.STATE_PLAYING
            : PlaybackState.STATE_PAUSED;
        if (nativeState == PlaybackState.STATE_PLAYING) {
            mainHandler.removeCallbacks(releasePlaybackWakeLock);
            if (!playbackWakeLock.isHeld()) playbackWakeLock.acquire();
        } else {
            mainHandler.removeCallbacks(releasePlaybackWakeLock);
            mainHandler.postDelayed(releasePlaybackWakeLock, PAUSED_WAKE_LOCK_GRACE_MS);
        }
        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setActions(toPlaybackActions(actions))
            .setState(nativeState, positionMs, playbackRate)
            .build());

        String nextNotificationSignature = AndroidMediaNotificationState.notificationSignature(
            nextMetadataSignature,
            playbackState,
            actions
        );
        // Every startForegroundService request needs an acknowledgement, even
        // when Android demoted an existing service whose notification is unchanged.
        if (foregroundStart || !nextNotificationSignature.equals(notificationSignature)) {
            startForeground(NOTIFICATION_ID, buildNotification(state, actions));
            notificationSignature = nextNotificationSignature;
        }
    }

    static void updateNativeState(com.getcapacitor.JSObject state) {
        AndroidMediaSessionService service = activeService.get();
        if (service == null || service.currentState == null) return;
        String owner = service.currentState.optString("nativeOwner", "");
        if (owner.isEmpty() || !owner.equals(state.optString("owner"))) return;
        if ("ended".equals(state.optString("event")) || "error".equals(state.optString("event"))) {
            service.stopPlaybackService();
            return;
        }
        try {
            service.currentState.put("position", state.optDouble("position", 0));
            service.currentState.put("duration", state.optDouble("duration", 0));
            service.currentState.put("playbackRate", state.optDouble("playbackRate", 1));
            service.currentState.put("playbackState", state.optBoolean("paused", true) ? "paused" : "playing");
            service.applyState(service.currentState);
        } catch (JSONException ignored) {
            service.stopPlaybackService();
        }
    }

    static void clearNativeOwner(String owner) {
        AndroidMediaSessionService service = activeService.get();
        if (service != null && service.currentState != null && owner != null && !owner.isEmpty() &&
            owner.equals(service.currentState.optString("nativeOwner", ""))) {
            service.stopPlaybackService();
        }
    }

    private void loadArtwork(String url) {
        if (url.equals(artworkUrl)) return;
        artworkUrl = url;
        artwork = null;
        if (url.isEmpty()) return;
        artworkExecutor.execute(() -> {
            Bitmap loaded = downloadArtwork(url);
            if (loaded == null) return;
            runOnMainThread(() -> {
                if (!url.equals(artworkUrl) || currentState == null) return;
                artwork = loaded;
                applyState(currentState);
            });
        });
    }

    private Bitmap downloadArtwork(String source) {
        try {
            URL url = new URL(source);
            for (int redirects = 0; redirects <= MAX_ARTWORK_REDIRECTS; redirects++) {
                if (!isSafeArtworkUrl(url)) return null;

                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                try {
                    connection.setConnectTimeout(5_000);
                    connection.setReadTimeout(5_000);
                    connection.setInstanceFollowRedirects(false);
                    int status = connection.getResponseCode();
                    if (isRedirectStatus(status)) {
                        String location = connection.getHeaderField("Location");
                        if (location == null || redirects == MAX_ARTWORK_REDIRECTS) return null;
                        url = new URL(url, location);
                        continue;
                    }
                    if (status < 200 || status >= 300) return null;
                    try (InputStream input = connection.getInputStream()) {
                        byte[] encoded = readArtworkBytes(input, connection.getContentLengthLong());
                        return encoded == null ? null : decodeArtwork(encoded);
                    }
                } finally {
                    connection.disconnect();
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    static byte[] readArtworkBytes(InputStream input, long contentLength) throws IOException {
        if (contentLength > MAX_ARTWORK_BYTES) return null;

        int initialSize = contentLength > 0 ? (int) contentLength : 8192;
        ByteArrayOutputStream output = new ByteArrayOutputStream(initialSize);
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (output.size() + read > MAX_ARTWORK_BYTES) return null;
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static Bitmap decodeArtwork(byte[] encoded) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        int sampleSize = calculateArtworkSampleSize(bounds.outWidth, bounds.outHeight);
        if (sampleSize == 0) return null;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inScaled = false;
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (
            decoded != null &&
            (
                !hasSafeArtworkDimensions(decoded.getWidth(), decoded.getHeight()) ||
                decoded.getByteCount() > MAX_ARTWORK_DECODED_BYTES
            )
        ) {
            decoded.recycle();
            return null;
        }
        return decoded;
    }

    static int calculateArtworkSampleSize(int width, int height) {
        if (width <= 0 || height <= 0) return 0;

        int sampleSize = 1;
        while (!hasSafeArtworkDimensions(
            (int) (((long) width + sampleSize - 1) / sampleSize),
            (int) (((long) height + sampleSize - 1) / sampleSize)
        )) {
            sampleSize *= 2;
        }
        return sampleSize;
    }

    static boolean hasSafeArtworkDimensions(int width, int height) {
        return width > 0 &&
            height > 0 &&
            width <= MAX_ARTWORK_DIMENSION &&
            height <= MAX_ARTWORK_DIMENSION &&
            (long) width * height <= MAX_ARTWORK_PIXELS &&
            (long) width * height * 4L <= MAX_ARTWORK_DECODED_BYTES;
    }

    static boolean isSafeArtworkUrl(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null) return false;
        try {
            InetAddress[] addresses = InetAddress.getAllByName(url.getHost());
            if (addresses.length == 0) return false;
            for (InetAddress address : addresses) {
                if (!isPublicAddress(address)) return false;
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isPublicAddress(InetAddress address) {
        if (
            address.isAnyLocalAddress() ||
            address.isLoopbackAddress() ||
            address.isLinkLocalAddress() ||
            address.isSiteLocalAddress() ||
            address.isMulticastAddress()
        ) {
            return false;
        }

        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int first = Byte.toUnsignedInt(bytes[0]);
            int second = Byte.toUnsignedInt(bytes[1]);
            return first != 0 && !(first == 100 && second >= 64 && second <= 127);
        }
        return bytes.length != 16 || (Byte.toUnsignedInt(bytes[0]) & 0xfe) != 0xfc;
    }

    private static boolean isRedirectStatus(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM ||
            status == HttpURLConnection.HTTP_MOVED_TEMP ||
            status == HttpURLConnection.HTTP_SEE_OTHER ||
            status == 307 ||
            status == 308;
    }

    private void runOnMainThread(Runnable runnable) {
        mainHandler.post(runnable);
    }

    private Notification buildNotification(JSONObject state, Set<String> actions) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(R.drawable.ic_stat_opentubex)
            .setContentTitle(state.optString("title", getString(R.string.app_name)))
            .setContentText(state.optString("artist", ""))
            .setContentIntent(openAppIntent())
            .setDeleteIntent(controlIntent(AndroidMediaActions.STOP, 90))
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing("playing".equals(state.optString("playbackState")));
        if (artwork != null) builder.setLargeIcon(artwork);

        List<String> notificationActions = notificationActions(actions, state.optString("playbackState"));
        int[] compactIndices = compactActionIndices(notificationActions);
        for (int index = 0; index < notificationActions.size(); index++) {
            builder.addAction(buildNotificationAction(notificationActions.get(index), index));
        }
        builder.setStyle(new Notification.MediaStyle()
            .setMediaSession(mediaSession.getSessionToken())
            .setShowActionsInCompactView(compactIndices));
        return builder.build();
    }

    private Notification.Action buildNotificationAction(String action, int requestCode) {
        int icon;
        int label;
        switch (action) {
            case AndroidMediaActions.PAUSE:
                icon = android.R.drawable.ic_media_pause;
                label = R.string.media_pause;
                break;
            case AndroidMediaActions.PREVIOUS:
                icon = android.R.drawable.ic_media_previous;
                label = R.string.media_previous;
                break;
            case AndroidMediaActions.NEXT:
                icon = android.R.drawable.ic_media_next;
                label = R.string.media_next;
                break;
            case AndroidMediaActions.SEEK_BACKWARD:
                icon = android.R.drawable.ic_media_rew;
                label = R.string.media_rewind;
                break;
            case AndroidMediaActions.SEEK_FORWARD:
                icon = android.R.drawable.ic_media_ff;
                label = R.string.media_fast_forward;
                break;
            case AndroidMediaActions.STOP:
                icon = android.R.drawable.ic_menu_close_clear_cancel;
                label = R.string.media_stop;
                break;
            default:
                icon = android.R.drawable.ic_media_play;
                label = R.string.media_play;
                break;
        }
        return new Notification.Action.Builder(icon, getString(label), controlIntent(action, requestCode)).build();
    }

    private PendingIntent openAppIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) launch = new Intent(this, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            this,
            100,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent controlIntent(String action, int requestCode) {
        Intent intent = new Intent(this, AndroidMediaSessionService.class)
            .setAction(ACTION_CONTROL_PREFIX + action);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void dispatchNotificationAction(String action) {
        if (!AndroidMediaActions.isSupported(action)) return;
        if (AndroidMediaActions.SEEK_BACKWARD.equals(action) || AndroidMediaActions.SEEK_FORWARD.equals(action)) {
            AndroidMediaSessionPlugin.emitAction(action, null, DEFAULT_SEEK_SECONDS);
        } else {
            AndroidMediaSessionPlugin.emitAction(action);
        }
    }

    private List<String> notificationActions(Set<String> actions, String playbackState) {
        List<String> result = new ArrayList<>();
        if (actions.contains(AndroidMediaActions.PREVIOUS)) result.add(AndroidMediaActions.PREVIOUS);
        else if (actions.contains(AndroidMediaActions.SEEK_BACKWARD)) result.add(AndroidMediaActions.SEEK_BACKWARD);

        String toggle = "playing".equals(playbackState) ? AndroidMediaActions.PAUSE : AndroidMediaActions.PLAY;
        if (actions.contains(toggle)) result.add(toggle);

        if (actions.contains(AndroidMediaActions.NEXT)) result.add(AndroidMediaActions.NEXT);
        else if (actions.contains(AndroidMediaActions.SEEK_FORWARD)) result.add(AndroidMediaActions.SEEK_FORWARD);

        if (actions.contains(AndroidMediaActions.STOP)) result.add(AndroidMediaActions.STOP);
        return result;
    }

    private int[] compactActionIndices(List<String> actions) {
        int count = Math.min(3, actions.size());
        int[] indices = new int[count];
        for (int index = 0; index < count; index++) indices[index] = index;
        return indices;
    }

    private Set<String> readActions(JSONArray values) {
        Set<String> actions = new HashSet<>();
        if (values == null) return actions;
        for (int index = 0; index < values.length(); index++) {
            String action = values.optString(index);
            if (AndroidMediaActions.isSupported(action)) actions.add(action);
        }
        return actions;
    }

    private long toPlaybackActions(Set<String> actions) {
        long result = 0;
        if (actions.contains(AndroidMediaActions.PLAY)) result |= PlaybackState.ACTION_PLAY;
        if (actions.contains(AndroidMediaActions.PAUSE)) result |= PlaybackState.ACTION_PAUSE;
        if (actions.contains(AndroidMediaActions.STOP)) result |= PlaybackState.ACTION_STOP;
        if (actions.contains(AndroidMediaActions.SEEK_BACKWARD)) result |= PlaybackState.ACTION_REWIND;
        if (actions.contains(AndroidMediaActions.SEEK_FORWARD)) result |= PlaybackState.ACTION_FAST_FORWARD;
        if (actions.contains(AndroidMediaActions.SEEK_TO)) result |= PlaybackState.ACTION_SEEK_TO;
        if (actions.contains(AndroidMediaActions.PREVIOUS)) result |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (actions.contains(AndroidMediaActions.NEXT)) result |= PlaybackState.ACTION_SKIP_TO_NEXT;
        return result;
    }

    private long secondsToMillis(double seconds) {
        if (!Double.isFinite(seconds) || seconds <= 0) return 0;
        return (long) Math.min(Long.MAX_VALUE, seconds * 1000);
    }

    private void stopPlaybackService() {
        String nativeOwner = currentState == null ? "" : currentState.optString("nativeOwner", "");
        currentState = null;
        AndroidPlaybackPlugin.pauseOwner(nativeOwner);
        artworkUrl = "";
        artwork = null;
        metadataSignature = "";
        notificationSignature = "";
        mainHandler.removeCallbacks(releasePlaybackWakeLock);
        releasePlaybackWakeLock.run();
        mediaSession.setActive(false);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        String nativeOwner = currentState == null ? "" : currentState.optString("nativeOwner", "");
        currentState = null;
        AndroidPlaybackPlugin.pauseOwner(nativeOwner);
        if (activeService.get() == this) activeService.clear();
        artworkUrl = "";
        artworkExecutor.shutdownNow();
        mainHandler.removeCallbacks(releasePlaybackWakeLock);
        releasePlaybackWakeLock.run();
        mediaSession.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
