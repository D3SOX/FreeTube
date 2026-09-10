package org.opentubex.app;

import android.net.Uri;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.media3.datasource.DefaultDataSource;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;

/** Renderer transport and controls for the native playback pipeline. */
@CapacitorPlugin(name = "AndroidPlayback")
public class AndroidPlaybackPlugin extends Plugin {
    private static java.lang.ref.WeakReference<AndroidPlaybackPlugin> active = new java.lang.ref.WeakReference<>(null);
    private static final int MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, CompletableFuture<byte[]>> requests = new ConcurrentHashMap<>();
    private final AtomicLong requestSequence = new AtomicLong();
    private final java.util.concurrent.ExecutorService frameEncoder = java.util.concurrent.Executors.newSingleThreadExecutor();
    private NativePlaybackEngine engine;
    private NativePlaybackSession session;
    private NativePlaybackScreen screen;
    private volatile String owner;
    private boolean activityVisible = true;
    private boolean pictureInPicture;

    @Override public void load() {
        active = new java.lang.ref.WeakReference<>(this);
    }

    private void ensurePlayer() {
        if (engine != null) return;
        engine = new NativePlaybackEngine(getContext(), NativePlaybackDataSource.factory(
            new DefaultDataSource.Factory(getContext()), this::readSegment
        ), state -> {
            state.put("owner", owner);
            notifyListeners("state", state);
            AndroidMediaSessionService.updateNativeState(state);
        });
        session = new NativePlaybackSession(engine);
        session.setVisibility(activityVisible, pictureInPicture);
    }

    @PluginMethod
    public void show(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            if (screen == null) {
                screen = new NativePlaybackScreen(getActivity(), engine,
                    call.getBoolean("webOverlay", false) ? getBridge().getWebView() : null,
                    call.getString("locale"), action -> {
                        if ("close".equals(action) && screen != null) screen.setFullscreen(false);
                        JSObject event = new JSObject();
                        event.put("owner", owner);
                        event.put("action", action);
                        notifyListeners("screenAction", event);
                    });
                getActivity().addContentView(screen, new android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT));
                screen.setPictureInPicture(pictureInPicture);
            }
            screen.setInlineVisible(true);
            boolean fullscreen = call.getBoolean("fullscreen", false);
            screen.setFullscreen(fullscreen);
            if (fullscreen) screen.afterWebFrame(call::resolve); else call.resolve();
        });
    }

    @PluginMethod
    public void screenLayout(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            if (screen != null) {
                if (call.getBoolean("endScroll", false)) {
                    screen.finishPageScroll();
                    call.resolve();
                    return;
                }
                if (call.getBoolean("endTransition", false)) {
                    screen.finishVideoTransition();
                    call.resolve();
                    return;
                }
                com.getcapacitor.JSObject transition = call.getObject("transition");
                if (transition != null) {
                    org.json.JSONObject from = transition.optJSONObject("from");
                    double[] target = { call.getDouble("x", 0.0), call.getDouble("y", 0.0), call.getDouble("width", 0.0), call.getDouble("height", 0.0), call.getDouble("viewportWidth", 0.0) };
                    if (from == null || !java.util.Arrays.stream(target).allMatch(Double::isFinite) || target[2] <= 0 || target[3] <= 0 || target[4] <= 0) {
                        call.reject("Invalid player transition bounds");
                        return;
                    }
                    double[] origin = { from.optDouble("x"), from.optDouble("y"), from.optDouble("width"), from.optDouble("height") };
                    if (!java.util.Arrays.stream(origin).allMatch(Double::isFinite) || origin[2] <= 0 || origin[3] <= 0) {
                        call.reject("Invalid player transition origin");
                        return;
                    }
                    screen.animateVideo(origin, target, Math.max(0, Math.min(1200, transition.optLong("duration", 300))),
                        (float) Math.max(0, Math.min(1000, transition.optDouble("radius", 0))), call::resolve);
                    return;
                }
                screen.setFollowsPageScroll(call.getBoolean("pageScroll", false));
                screen.setMiniPlayer(call.getBoolean("miniPlayer", false), (float) Math.max(0, Math.min(1000, call.getDouble("radius", 0.0))));
                Boolean visible = call.getBoolean("videoVisible");
                if (visible != null) screen.setInlineVisible(visible);
                screen.setWebOverlayActive(call.getBoolean("overlayActive", false));
                Boolean controlsVisible = call.getBoolean("controlsVisible");
                if (controlsVisible != null) screen.setControlsVisible(controlsVisible);
                double x = call.getDouble("x", 0.0);
                double y = call.getDouble("y", 0.0);
                double width = call.getDouble("width", 0.0);
                double height = call.getDouble("height", 0.0);
                double viewportWidth = call.getDouble("viewportWidth", 0.0);
                if (viewportWidth > 0 && Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(width) &&
                    Double.isFinite(height) && Double.isFinite(viewportWidth)) {
                    screen.layoutVideo(x, y, width, height, viewportWidth);
                    com.getcapacitor.JSArray menus = call.getArray("menus", new com.getcapacitor.JSArray());
                    java.util.ArrayList<android.graphics.RectF> menuBounds = new java.util.ArrayList<>();
                    java.util.ArrayList<android.graphics.RectF> scrollingMenuBounds = new java.util.ArrayList<>();
                    double scale = screen.getWidth() / viewportWidth;
                    for (int index = 0; index < menus.length(); index++) {
                        org.json.JSONObject menu = menus.optJSONObject(index);
                        if (menu == null) continue;
                        double menuX = menu.optDouble("x");
                        double menuY = menu.optDouble("y");
                        double menuWidth = menu.optDouble("width");
                        double menuHeight = menu.optDouble("height");
                        if (Double.isFinite(menuX) && Double.isFinite(menuY) && Double.isFinite(menuWidth) &&
                            Double.isFinite(menuHeight) && menuWidth > 0 && menuHeight > 0) {
                            (menu.optBoolean("pageScroll", false) ? scrollingMenuBounds : menuBounds).add(new android.graphics.RectF((float) (menuX * scale), (float) (menuY * scale),
                                (float) ((menuX + menuWidth) * scale), (float) ((menuY + menuHeight) * scale)));
                        }
                    }
                    screen.setMenuBounds(menuBounds.toArray(new android.graphics.RectF[0]));
                    screen.setScrollingMenuBounds(scrollingMenuBounds.toArray(new android.graphics.RectF[0]));
                    double controlsX = call.getDouble("controlsX", x);
                    double controlsY = call.getDouble("controlsY", y);
                    double controlsWidth = call.getDouble("controlsWidth", width);
                    double controlsHeight = call.getDouble("controlsHeight", height);
                    if (Double.isFinite(controlsX) && Double.isFinite(controlsY) &&
                        Double.isFinite(controlsWidth) && Double.isFinite(controlsHeight)) {
                        screen.layoutControls(controlsX, controlsY, controlsWidth, controlsHeight, viewportWidth);
                    }
                }
                screen.setGestureActive(call.getBoolean("gestureActive", false));
            }
            call.resolve();
        });
    }

    static boolean handleBack() {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin == null || plugin.screen == null || !plugin.screen.isFullscreen()) return false;
        plugin.screen.back();
        return true;
    }

    static void pictureInPictureChanged(boolean enabled) {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin == null) return;
        plugin.pictureInPicture = enabled;
        if (plugin.screen != null) plugin.screen.setPictureInPicture(enabled);
        if (plugin.session != null) plugin.session.setVisibility(plugin.activityVisible, plugin.activityVisible && enabled);
    }

    @PluginMethod
    public void hide(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            if (screen != null) screen.setFullscreen(false);
            call.resolve();
        });
    }

    private void closeScreen() {
        if (screen == null) return;
        screen.close();
        screen = null;
    }

    @PluginMethod
    public void setOwner(PluginCall call) {
        mainHandler.post(() -> {
            String next = call.getString("owner");
            if (next != null && (next.length() > 128 || !next.matches("[a-z0-9-]+"))) {
                call.reject("Invalid native playback owner");
                return;
            }
            if (next == null && session == null) {
                call.resolve();
                return;
            }
            ensurePlayer();
            if (!java.util.Objects.equals(owner, next)) {
                if (owner != null) {
                    // Publish the outgoing position before stop/clear emits a
                    // zero-position snapshot. Suspended tabs retain this clock.
                    JSObject outgoing = engine.snapshot();
                    outgoing.put("owner", owner);
                    outgoing.put("event", "suspended");
                    outgoing.put("paused", true);
                    outgoing.put("playing", false);
                    notifyListeners("state", outgoing);
                }
                String previousOwner = owner;
                owner = null;
                AndroidMediaSessionService.clearNativeOwner(previousOwner);
                cancelRequests();
                closeScreen();
                session.setOwner(next);
                owner = next;
            }
            session.setContinueInBackground(call.getBoolean("continueInBackground", true));
            call.resolve();
        });
    }

    @PluginMethod
    public void configure(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            Boolean continueInBackground = call.getBoolean("continueInBackground");
            if (continueInBackground != null) session.setContinueInBackground(continueInBackground);
            if (call.getData().has("seekSeconds")) {
                double seconds = call.getData().optDouble("seekSeconds", 10);
                if (!Double.isFinite(seconds) || seconds <= 0) { call.reject("Invalid seek interval"); return; }
                engine.setSeekPreferences(seconds, call.getBoolean("scaleSeekWithRate", false));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            AndroidMediaSessionService.clearNativeOwner(owner);
            cancelRequests();
            closeScreen();
            session.clear();
            owner = null;
            call.resolve();
        });
    }

    @PluginMethod
    public void loadSource(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            String source = call.getString("source");
            if (source == null || source.isEmpty()) {
                call.reject("A media source is required");
                return;
            }
            // Capacitor's getLong accepts only boxed Long values. Ordinary JSON
            // millisecond positions arrive as Integer or Double instead.
            double positionMs = call.getData().optDouble("positionMs", 0);
            if (!Double.isFinite(positionMs)) {
                call.reject("Playback position must be finite");
                return;
            }
            cancelRequests();
            JSObject state = call.getObject("metadata", new JSObject());
            state.put("nativeOwner", owner);
            if (!state.has("actions")) {
                state.put("actions", new org.json.JSONArray(java.util.Arrays.asList(
                    AndroidMediaActions.PLAY, AndroidMediaActions.PAUSE, AndroidMediaActions.STOP,
                    AndroidMediaActions.SEEK_TO, AndroidMediaActions.SEEK_BACKWARD, AndroidMediaActions.SEEK_FORWARD)));
            }
            state.put("playbackState", call.getBoolean("play", false) ? "playing" : "paused");
            try {
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), AndroidMediaSessionService.class)
                    .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                    .putExtra(AndroidMediaSessionService.EXTRA_STATE, state.toString()));
            } catch (IllegalStateException | SecurityException error) {
                call.reject("Android did not allow starting the playback service", error);
                return;
            }
            engine.setMimeType(call.getString("mimeType"));
            engine.setAudioOnly(call.getBoolean("audioOnly", false));
            session.load(owner, source, (long) Math.max(0, positionMs));
            if (call.getBoolean("play", false) && session.canPlay(owner)) engine.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void command(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            String action = call.getString("action", "");
            double value = call.getDouble("value", 0.0);
            if (!Double.isFinite(value)) {
                call.reject("Playback values must be finite");
                return;
            }
            switch (action) {
                case "play":
                    if (!session.canPlay(owner)) {
                        call.reject("Background playback is disabled or no source is loaded");
                        return;
                    }
                    engine.play();
                    break;
                case "pause": engine.pause(); break;
                case "seek": engine.seek((long) (Math.max(0, value) * 1000)); break;
                case "live": engine.seekToLive(); break;
                case "speed": engine.setSpeed((float) Math.max(0.1, Math.min(16, value))); break;
                case "volume": engine.setVolume((float) Math.max(0, Math.min(1, value))); break;
                case "skipSilence": engine.setSkipSilence(value != 0); break;
                case "loop": engine.setLoop(value != 0); break;
                case "stop":
                    AndroidMediaSessionService.clearNativeOwner(owner);
                    cancelRequests();
                    session.release(owner);
                    break;
                default:
                    call.reject("Unsupported native playback command");
                    return;
            }
            call.resolve(engine.snapshot());
        });
    }

    @PluginMethod
    public void setCaptionCues(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            boolean visible = call.getBoolean("visible", true);
            if (call.getData().has("cues")) {
                com.getcapacitor.JSArray values = call.getArray("cues");
                java.util.List<NativeCaptionTimeline.Entry> cues = values == null ? null : new java.util.ArrayList<>();
                if (values != null) {
                    for (int index = 0; index < values.length(); index++) {
                        org.json.JSONObject value = values.optJSONObject(index);
                        double start = value == null ? Double.NaN : value.optDouble("startTime", Double.NaN);
                        double end = value == null ? Double.NaN : value.optDouble("endTime", Double.NaN);
                        if (!Double.isFinite(start) || !Double.isFinite(end) || start < 0 || end <= start || end > Long.MAX_VALUE / 1000.0) {
                            call.reject("Invalid external caption interval");
                            return;
                        }
                        cues.add(new NativeCaptionTimeline.Entry((long) (start * 1000), (long) (end * 1000), value.optString("text", "")));
                    }
                }
                engine.setCaptionCues(cues, visible);
            } else engine.setCaptionsVisible(visible);
            call.resolve();
        });
    }

    @PluginMethod
    public void getTracks(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            JSObject result = new JSObject();
            result.put("tracks", engine.trackSnapshot());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void loadVoiceOver(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            String id = call.getString("sourceId");
            if (id == null || id.length() > 128) { call.reject("A voice-over source id is required"); return; }
            engine.getVoiceOver().load(id, call.getString("source", ""));
            call.resolve();
        });
    }

    @PluginMethod
    public void voiceOverCommand(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            double value = call.getDouble("value", 0.0);
            if (!Double.isFinite(value) || !engine.getVoiceOver().command(call.getString("sourceId"),
                call.getString("action", ""), value)) {
                call.reject("Invalid voice-over playback command");
                return;
            }
            JSObject state = engine.getVoiceOver().snapshot();
            if ("seek".equals(call.getString("action"))) state.put("event", "seeked");
            call.resolve(state);
        });
    }

    @PluginMethod
    public void getAudioSpectrum(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            com.getcapacitor.JSArray bins = new com.getcapacitor.JSArray();
            for (int value : engine.getSpectrum()) bins.put(value);
            JSObject result = new JSObject();
            result.put("bins", bins);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void captureFrame(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            int width = call.getInt("width", engine.getPlayer().getVideoSize().width);
            int height = call.getInt("height", engine.getPlayer().getVideoSize().height);
            if (screen == null || width <= 0 || height <= 0 || (long) width * height > 16777216) {
                call.reject("No visible video frame is available at this size");
                return;
            }
            android.graphics.Bitmap bitmap = screen.captureFrame(width, height);
            if (bitmap == null) {
                call.reject("No video frame is available yet");
                return;
            }
            frameEncoder.execute(() -> encodeFrame(bitmap, call));
        });
    }

    static void encodeFrame(android.graphics.Bitmap bitmap, PluginCall call) {
        try {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            boolean jpeg = "jpeg".equals(call.getString("format"));
            boolean compressed = bitmap.compress(jpeg ? android.graphics.Bitmap.CompressFormat.JPEG : android.graphics.Bitmap.CompressFormat.PNG,
                jpeg ? 90 : 100, bytes);
            if (!compressed) {
                call.reject("The video frame could not be encoded");
                return;
            }
            JSObject result = new JSObject();
            result.put("dataUrl", "data:image/" + (jpeg ? "jpeg" : "png") + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (RuntimeException | OutOfMemoryError error) {
            call.reject("The video frame could not be encoded");
        } finally {
            bitmap.recycle();
        }
    }

    @PluginMethod
    public void selectTrack(PluginCall call) {
        mainHandler.post(() -> {
            if (!checkOwner(call)) return;
            if (!engine.selectTrack(call.getInt("type", -1), call.getInt("group", -1),
                call.getInt("index", -1), call.getBoolean("disabled", false))) {
                call.reject("Invalid native playback track");
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        mainHandler.post(() -> {
            if (checkOwner(call)) call.resolve(engine.snapshot());
        });
    }

    @PluginMethod
    public void respond(PluginCall call) {
        String id = call.getString("requestId", "");
        CompletableFuture<byte[]> pending = requests.remove(id);
        if (pending == null) {
            call.resolve();
            return;
        }
        String error = call.getString("error");
        if (error != null) {
            pending.completeExceptionally(new IOException(error));
            call.resolve();
            return;
        }
        String encoded = call.getString("data", "");
        if (encoded.length() > (MAX_SEGMENT_BYTES + 2L) / 3 * 4) {
            pending.completeExceptionally(new IOException("SABR segment exceeds the size limit"));
            call.reject("SABR segment exceeds the size limit");
            return;
        }
        try {
            byte[] data = Base64.decode(encoded, Base64.NO_WRAP);
            if (data.length > MAX_SEGMENT_BYTES) throw new IllegalArgumentException("Segment is too large");
            pending.complete(data);
            call.resolve();
        } catch (IllegalArgumentException errorValue) {
            pending.completeExceptionally(new IOException("Invalid SABR segment", errorValue));
            call.reject("Invalid SABR segment");
        }
    }

    private byte[] readSegment(Uri uri, long position, long length) throws IOException {
        String requestOwner = owner;
        if (requestOwner == null || !requestOwner.equals(uri.getHost())) {
            throw new IOException("The SABR session no longer owns playback");
        }
        String id = Long.toString(requestSequence.incrementAndGet());
        CompletableFuture<byte[]> pending = new CompletableFuture<>();
        requests.put(id, pending);
        mainHandler.post(() -> {
            if (!java.util.Objects.equals(owner, requestOwner) || !requests.containsKey(id)) {
                pending.completeExceptionally(new IOException("Playback was replaced"));
                return;
            }
            JSObject event = new JSObject();
            event.put("owner", requestOwner);
            event.put("requestId", id);
            event.put("uri", uri.toString());
            event.put("position", position);
            event.put("length", length);
            notifyListeners("segment", event);
        });
        try {
            return pending.get(45, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("SABR segment was cancelled", error);
        } catch (ExecutionException | TimeoutException error) {
            throw new IOException("SABR segment could not be loaded", error);
        } finally {
            requests.remove(id);
        }
    }

    private boolean checkOwner(PluginCall call) {
        if (session != null && session.isOwner(call.getString("owner"))) return true;
        call.reject("This tab does not own native playback");
        return false;
    }

    private void cancelRequests() {
        for (CompletableFuture<byte[]> pending : requests.values()) {
            pending.completeExceptionally(new IOException("Playback was replaced"));
        }
        requests.clear();
    }

    static void stopOwner(String stoppedOwner) {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin == null || plugin.session == null || !plugin.session.isOwner(stoppedOwner)) return;
        plugin.cancelRequests();
        plugin.session.release(stoppedOwner);
    }

    static void pauseOwner(String stoppedOwner) {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin != null && plugin.session != null && plugin.session.isOwner(stoppedOwner)) plugin.engine.pause();
    }

    static boolean acceptsMediaOwner(String candidate) {
        AndroidPlaybackPlugin plugin = active.get();
        String current = plugin == null ? null : plugin.owner;
        return java.util.Objects.equals(current == null ? "" : current, candidate == null ? "" : candidate);
    }

    static void updateQueueActions(String sourceOwner, java.util.Set<String> actions) {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin != null && plugin.engine != null && plugin.session.isOwner(sourceOwner)) {
            plugin.engine.setQueueActions(actions);
        }
    }

    static boolean handleAction(String action, Double seekTime, Double seekOffset) {
        AndroidPlaybackPlugin plugin = active.get();
        if (plugin == null || plugin.engine == null || plugin.engine.getPlayer().getMediaItemCount() == 0) return false;
        switch (action) {
            case AndroidMediaActions.PLAY:
                if (plugin.session.canPlay(plugin.owner)) plugin.engine.play();
                return true;
            case AndroidMediaActions.PAUSE:
                plugin.engine.pause();
                return true;
            case AndroidMediaActions.SEEK_TO:
                if (seekTime != null && Double.isFinite(seekTime)) plugin.engine.seek((long) (seekTime * 1000));
                return true;
            case AndroidMediaActions.SEEK_BACKWARD:
            case AndroidMediaActions.SEEK_FORWARD:
                double offset = seekOffset != null && Double.isFinite(seekOffset) ? seekOffset : plugin.engine.getSeekSeconds();
                long current = plugin.engine.getPlayer().getCurrentPosition();
                plugin.engine.seek(current + (long) (offset * 1000 * (AndroidMediaActions.SEEK_BACKWARD.equals(action) ? -1 : 1)));
                return true;
            case AndroidMediaActions.STOP:
                plugin.getContext().stopService(new Intent(plugin.getContext(), AndroidMediaSessionService.class));
                stopOwner(plugin.owner);
                // Let the owning Watch page perform its ordinary stop cleanup too.
                return false;
            default:
                return false;
        }
    }

    @Override protected void handleOnStart() {
        mainHandler.post(() -> {
            activityVisible = true;
            if (session != null) session.setVisibility(true, pictureInPicture);
        });
    }

    @Override protected void handleOnStop() {
        mainHandler.post(() -> {
            activityVisible = false;
            // An Activity remains started while its PiP surface is visible.
            // A stopped PiP Activity is no longer visible either, for example
            // when the screen locks while the window is still in PiP mode.
            if (session != null) session.setVisibility(false, false);
        });
    }

    @Override protected void handleOnDestroy() {
        mainHandler.post(() -> {
            frameEncoder.shutdown();
            closeScreen();
            cancelRequests();
            if (session != null) session.clear();
            if (engine != null) engine.release();
            engine = null;
            session = null;
            owner = null;
            if (active.get() == this) active.clear();
        });
    }
}
