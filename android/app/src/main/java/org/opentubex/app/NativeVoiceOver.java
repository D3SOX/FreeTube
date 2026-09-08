package org.opentubex.app;

import android.content.Context;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import com.getcapacitor.JSObject;

/** Optional translated speech, synchronized with the original native player. */
final class NativeVoiceOver {
    private final Context context;
    private final Player original;
    private final Runnable changed;
    private ExoPlayer player;
    private String sourceId;
    private boolean enabled;

    NativeVoiceOver(Context context, Player original, Runnable changed) {
        this.context = context.getApplicationContext();
        this.original = original;
        this.changed = changed;
    }

    void load(String id, String source) {
        if (source.isEmpty()) {
            if (matches(id)) clear();
            return;
        }
        clear();
        sourceId = id;
        player = new ExoPlayer.Builder(context).build();
        // The original player owns audio focus and the foreground service.
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), false);
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player ignored, Player.Events events) { changed.run(); }
        });
        player.setMediaItem(MediaItem.fromUri(source), original.getCurrentPosition());
        player.setPlaybackSpeed(original.getPlaybackParameters().speed);
        player.prepare();
    }

    boolean matches(String id) { return player != null && sourceId != null && sourceId.equals(id); }

    boolean command(String id, String action, double value) {
        if (!matches(id)) return false;
        switch (action) {
            case "play":
                if (!enabled || !player.getPlayWhenReady()) {
                    enabled = true;
                    syncPlayback();
                }
                break;
            case "pause": enabled = false; player.pause(); break;
            case "seek": player.seekTo((long) (Math.max(0, value) * 1000)); break;
            case "speed": player.setPlaybackSpeed((float) Math.max(0.1, Math.min(16, value))); break;
            case "volume": player.setVolume((float) Math.max(0, Math.min(1, value))); break;
            case "loop": player.setRepeatMode(value != 0 ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF); break;
            default: return false;
        }
        return true;
    }

    void syncPlayback() {
        if (player == null) return;
        if (enabled && original.isPlaying()) {
            player.seekTo(original.getCurrentPosition());
            player.play();
        } else player.pause();
    }

    void syncPlaybackRate() {
        if (player != null) player.setPlaybackSpeed(original.getPlaybackParameters().speed);
    }

    JSObject snapshot() {
        if (player == null) return null;
        JSObject state = new JSObject();
        state.put("sourceId", sourceId);
        state.put("position", player.getCurrentPosition() / 1000.0);
        state.put("duration", player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration() / 1000.0);
        state.put("paused", !player.getPlayWhenReady());
        state.put("playing", player.isPlaying());
        state.put("ready", player.getPlaybackState() == Player.STATE_READY);
        state.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        state.put("ended", player.getPlaybackState() == Player.STATE_ENDED);
        state.put("playbackRate", player.getPlaybackParameters().speed);
        if (player.getPlayerError() != null) state.put("error", player.getPlayerError().getMessage());
        return state;
    }

    void clear() {
        sourceId = null;
        enabled = false;
        if (player != null) {
            ExoPlayer outgoing = player;
            player = null;
            outgoing.release();
        }
    }
}
