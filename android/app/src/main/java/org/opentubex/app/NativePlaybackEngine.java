package org.opentubex.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Format;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.VideoSize;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;

import java.util.function.Consumer;

/** Owns decoding and the audio clock independently of the Activity's video surface. */
final class NativePlaybackEngine implements NativePlaybackSession.Playback {
    private final ExoPlayer player;
    private final NativeQueuePlayer controlsPlayer;
    private final NativeVoiceOver voiceOver;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Consumer<JSObject> listener;
    private final DefaultBandwidthMeter bandwidthMeter;
    private Surface surface;
    private boolean videoVisible = true;
    private boolean released;
    private String mimeType;
    private final NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
    private final java.util.Set<Consumer<java.util.List<androidx.media3.common.text.Cue>>> captionListeners = new java.util.HashSet<>();
    private NativeCaptionTimeline externalCaptions;
    private boolean captionsVisible = true;
    private java.util.List<NativeCaptionTimeline.Entry> activeExternalCues = java.util.Collections.emptyList();
    private java.util.List<androidx.media3.common.text.Cue> captionCues = java.util.Collections.emptyList();
    private final Runnable updateCaptionPosition = this::updateCaptionCues;
    private final Runnable publishPosition = new Runnable() {
        @Override public void run() {
            if (released) return;
            publish("timeupdate");
            handler.postDelayed(this, 250);
        }
    };

    NativePlaybackEngine(Context context, DataSource.Factory dataSource, Consumer<JSObject> listener) {
        this.listener = listener;
        bandwidthMeter = DefaultBandwidthMeter.getSingletonInstance(context);
        androidx.media3.exoplayer.DefaultRenderersFactory renderers = new androidx.media3.exoplayer.DefaultRenderersFactory(context) {
            @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(
                Context audioContext, boolean floatOutput, boolean playbackParameters
            ) {
                androidx.media3.exoplayer.audio.TeeAudioProcessor tap = new androidx.media3.exoplayer.audio.TeeAudioProcessor(
                    new androidx.media3.exoplayer.audio.TeeAudioProcessor.AudioBufferSink() {
                        private int channels;
                        private int encoding;
                        @Override public void flush(int sampleRate, int channelCount, int pcmEncoding) {
                            channels = channelCount;
                            encoding = pcmEncoding;
                            spectrum.reset();
                        }
                        @Override public void handleBuffer(java.nio.ByteBuffer buffer) {
                            if (encoding == C.ENCODING_PCM_16BIT) spectrum.append(buffer, channels);
                        }
                    });
                return new androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(audioContext)
                    .setAudioProcessors(new androidx.media3.common.audio.AudioProcessor[] { tap })
                    .setEnableAudioOutputPlaybackParameters(playbackParameters).build();
            }
        };
        player = new ExoPlayer.Builder(context.getApplicationContext(), renderers)
            .setLoadControl(createLoadControl())
            .setBandwidthMeter(bandwidthMeter)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSource))
            .build();
        controlsPlayer = new NativeQueuePlayer(player);
        voiceOver = new NativeVoiceOver(context, player, () -> publish("voiceover"));
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                publish(state == Player.STATE_ENDED ? "ended" : "statechange");
            }

            @Override public void onIsPlayingChanged(boolean playing) {
                voiceOver.syncPlayback();
                updateCaptionCues();
                handler.removeCallbacks(publishPosition);
                publish(playing ? "playing" : "statechange");
                if (playing) handler.post(publishPosition);
            }

            @Override public void onPlayWhenReadyChanged(boolean play, int reason) {
                publish(play ? "play" : "pause");
            }

            @Override public void onPositionDiscontinuity(
                Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason
            ) {
                updateCaptionCues();
                publish("seeked");
            }

            @Override public void onVideoSizeChanged(VideoSize size) {
                publish("resize");
            }

            @Override public void onTracksChanged(Tracks tracks) {
                JSObject event = snapshot();
                event.put("event", "trackschanged");
                event.put("tracks", trackSnapshot());
                listener.accept(event);
            }

            @Override public void onCues(androidx.media3.common.text.CueGroup group) {
                updateCaptionCues();
                JSArray cues = new JSArray();
                for (androidx.media3.common.text.Cue cue : group.cues) {
                    if (cue.text == null) continue;
                    // Preserve text spans while letting Watch apply the user's
                    // caption appearance, positioning, and inline layout.
                    cues.put(cue.text instanceof android.text.Spanned
                        ? android.text.Html.toHtml((android.text.Spanned) cue.text,
                            android.text.Html.TO_HTML_PARAGRAPH_LINES_CONSECUTIVE).trim()
                        : android.text.Html.escapeHtml(cue.text));
                }
                JSObject event = snapshot();
                event.put("event", "cues");
                event.put("cues", cues);
                listener.accept(event);
            }

            @Override public void onPlaybackParametersChanged(androidx.media3.common.PlaybackParameters parameters) {
                updateCaptionCues();
                publish("ratechange");
            }

            @Override public void onVolumeChanged(float volume) {
                publish("volumechange");
            }

            @Override public void onPlayerError(PlaybackException error) {
                JSObject event = snapshot();
                event.put("event", "error");
                event.put("errorCode", error.errorCode);
                event.put("message", error.getMessage());
                listener.accept(event);
            }
        });
    }

    static androidx.media3.exoplayer.DefaultLoadControl createLoadControl() {
        // SABR uses an in-memory DASH manifest, but its segments are remote.
        // Media3's local-media default waits until only one second remains.
        // Apply streaming thresholds to both URI types and retain Watch's
        // three-minute buffering goal.
        return new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(50_000, 180_000, 1000, 2000)
            .build();
    }

    void setMimeType(String value) {
        mimeType = value;
    }

    void setAudioOnly(boolean enabled) {
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, enabled).build());
    }

    void setCaptionCues(java.util.List<NativeCaptionTimeline.Entry> cues, boolean visible) {
        externalCaptions = cues == null ? null : new NativeCaptionTimeline(cues);
        activeExternalCues = null;
        captionsVisible = visible;
        updateCaptionCues();
    }

    void setCaptionsVisible(boolean visible) {
        captionsVisible = visible;
        activeExternalCues = null;
        updateCaptionCues();
    }

    java.util.List<androidx.media3.common.text.Cue> getCaptionCues() { return captionCues; }
    void addCaptionListener(Consumer<java.util.List<androidx.media3.common.text.Cue>> listener) { captionListeners.add(listener); }
    void removeCaptionListener(Consumer<java.util.List<androidx.media3.common.text.Cue>> listener) { captionListeners.remove(listener); }

    private void updateCaptionCues() {
        handler.removeCallbacks(updateCaptionPosition);
        if (released) return;
        java.util.List<androidx.media3.common.text.Cue> next;
        if (!captionsVisible) {
            next = java.util.Collections.emptyList();
        } else if (externalCaptions == null) {
            next = player.getCurrentCues().cues;
        } else {
            long position = player.getCurrentPosition();
            java.util.List<NativeCaptionTimeline.Entry> active = externalCaptions.at(position);
            next = captionCues;
            if (!active.equals(activeExternalCues)) {
                next = new java.util.ArrayList<>();
                for (NativeCaptionTimeline.Entry cue : active) next.add(new androidx.media3.common.text.Cue.Builder().setText(cue.text).build());
                activeExternalCues = active;
            }
            if (player.isPlaying()) {
                long boundary = externalCaptions.nextBoundary(position);
                long delay = boundary == Long.MAX_VALUE ? 250 : Math.min(250,
                    Math.max(1, (long) Math.ceil((boundary - position) / (double) player.getPlaybackParameters().speed)));
                handler.postDelayed(updateCaptionPosition, delay);
            }
        }
        if (!next.equals(captionCues)) {
            captionCues = next;
            for (Consumer<java.util.List<androidx.media3.common.text.Cue>> listener : captionListeners) listener.accept(captionCues);
        }
    }

    @Override public void load(String source, long positionMs) {
        player.setPlayWhenReady(false);
        MediaItem item = new MediaItem.Builder().setUri(source).setMimeType(mimeType).build();
        player.setMediaItem(item, positionMs);
        player.prepare();
    }

    void play() {
        if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
        player.play();
    }
    @Override public void pause() { player.pause(); }
    void seek(long positionMs) { player.seekTo(Math.max(0, positionMs)); }
    void seekToLive() { player.seekToDefaultPosition(); }
    void setSpeed(float speed) { player.setPlaybackSpeed(speed); }
    void setVolume(float volume) { player.setVolume(volume); }
    void setSkipSilence(boolean enabled) { player.setSkipSilenceEnabled(enabled); }
    void setLoop(boolean enabled) { player.setRepeatMode(enabled ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF); }
    Player getPlayer() { return player; }
    Player getControlsPlayer() { return controlsPlayer; }
    void setQueueActions(java.util.Set<String> actions) { controlsPlayer.setActions(actions); }
    void setSeekPreferences(double seconds, boolean scaleWithRate) { controlsPlayer.setSeekPreferences(seconds, scaleWithRate); }
    double getSeekSeconds() { return controlsPlayer.getSeekBackIncrement() / 1000.0; }
    int[] getSpectrum() { return spectrum.snapshot(); }
    NativeVoiceOver getVoiceOver() { return voiceOver; }

    JSArray trackSnapshot() {
        JSArray result = new JSArray();
        java.util.List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
        for (int groupIndex = 0; groupIndex < groups.size(); groupIndex++) {
            Tracks.Group group = groups.get(groupIndex);
            for (int trackIndex = 0; trackIndex < group.length; trackIndex++) {
                Format format = group.getTrackFormat(trackIndex);
                JSObject track = new JSObject();
                track.put("group", groupIndex);
                track.put("index", trackIndex);
                track.put("type", group.getType());
                track.put("id", format.id);
                track.put("selected", group.isTrackSelected(trackIndex));
                track.put("supported", group.isTrackSupported(trackIndex));
                track.put("label", format.label);
                track.put("language", format.language);
                track.put("width", format.width);
                track.put("height", format.height);
                track.put("frameRate", format.frameRate);
                if (format.colorInfo != null) {
                    if (format.colorInfo.colorTransfer == C.COLOR_TRANSFER_ST2084) track.put("hdr", "PQ");
                    else if (format.colorInfo.colorTransfer == C.COLOR_TRANSFER_HLG) track.put("hdr", "HLG");
                }
                track.put("bitrate", format.bitrate);
                track.put("channels", format.channelCount);
                track.put("sampleRate", format.sampleRate);
                track.put("codecs", format.codecs);
                track.put("mimeType", format.sampleMimeType);
                track.put("roleFlags", format.roleFlags);
                result.put(track);
            }
        }
        return result;
    }

    boolean selectTrack(int type, int groupIndex, int trackIndex, boolean disabled) {
        if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_VIDEO && type != C.TRACK_TYPE_TEXT) return false;
        androidx.media3.common.TrackSelectionParameters.Builder selection = player.getTrackSelectionParameters()
            .buildUpon().clearOverridesOfType(type).setTrackTypeDisabled(type, disabled);
        if (!disabled && groupIndex >= 0) {
            java.util.List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
            if (groupIndex >= groups.size()) return false;
            Tracks.Group group = groups.get(groupIndex);
            if (group.getType() != type || trackIndex < 0 || trackIndex >= group.length || !group.isTrackSupported(trackIndex)) return false;
            selection.setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), trackIndex));
        }
        player.setTrackSelectionParameters(selection.build());
        return true;
    }

    @Override public void stop() {
        voiceOver.clear();
        setCaptionCues(null, true);
        handler.removeCallbacks(publishPosition);
        player.pause();
        player.stop();
        player.clearMediaItems();
    }

    void setSurface(Surface nextSurface) {
        surface = nextSurface;
        player.setVideoSurface(videoVisible ? surface : null);
    }

    @Override public void setVideoVisible(boolean visible) {
        if (videoVisible == visible) return;
        videoVisible = visible;
        // ExoPlayer keeps its audio renderer and buffered media when the display
        // surface is removed. Never prepare, seek, or replace the item here.
        player.setVideoSurface(visible ? surface : null);
    }

    JSObject snapshot() {
        JSObject result = new JSObject();
        result.put("elapsedRealtimeMs", android.os.SystemClock.elapsedRealtime());
        result.put("position", player.getCurrentPosition() / 1000.0);
        result.put("bufferedPosition", player.getBufferedPosition() / 1000.0);
        result.put("duration", player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration() / 1000.0);
        result.put("paused", !player.getPlayWhenReady());
        result.put("playing", player.isPlaying());
        result.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        result.put("ended", player.getPlaybackState() == Player.STATE_ENDED);
        result.put("ready", player.getPlaybackState() == Player.STATE_READY);
        result.put("playbackRate", player.getPlaybackParameters().speed);
        result.put("volume", player.getVolume());
        result.put("width", player.getVideoSize().width);
        result.put("height", player.getVideoSize().height);
        result.put("live", player.isCurrentMediaItemLive());
        result.put("seekable", player.isCurrentMediaItemSeekable());
        result.put("skipSilence", player.getSkipSilenceEnabled());
        result.put("estimatedBandwidth", bandwidthMeter.getBitrateEstimate());
        JSObject translated = voiceOver.snapshot();
        if (translated != null) result.put("voiceOver", translated);
        androidx.media3.exoplayer.DecoderCounters counters = player.getVideoDecoderCounters();
        if (counters != null) {
            counters.ensureUpdated();
            result.put("totalFrames", counters.renderedOutputBufferCount + counters.droppedBufferCount);
            result.put("droppedFrames", counters.droppedBufferCount);
        }
        return result;
    }

    private void publish(String type) {
        if (released) return;
        JSObject state = snapshot();
        state.put("event", type);
        listener.accept(state);
    }

    void release() {
        released = true;
        voiceOver.clear();
        handler.removeCallbacksAndMessages(null);
        surface = null;
        captionListeners.clear();
        player.release();
    }
}
