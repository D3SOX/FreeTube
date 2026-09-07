package org.opentubex.app;

import java.util.Objects;

/** Main-thread ownership and visibility policy for a continuously loaded native player. */
final class NativePlaybackSession {
    interface Playback {
        void load(String source, long positionMs);
        void pause();
        void stop();
        void setVideoVisible(boolean visible);
    }

    private final Playback playback;
    private String owner;
    private boolean loaded;
    private boolean visible = true;
    private boolean continueInBackground = true;

    NativePlaybackSession(Playback playback) {
        this.playback = playback;
    }

    void setOwner(String nextOwner) {
        if (Objects.equals(owner, nextOwner)) return;
        stop();
        owner = nextOwner;
    }

    boolean isOwner(String candidate) {
        return owner != null && !owner.isEmpty() && owner.equals(candidate);
    }

    boolean canPlay(String candidate) {
        return isOwner(candidate) && loaded && (visible || continueInBackground);
    }

    boolean load(String candidate, String source, long positionMs) {
        if (!isOwner(candidate)) return false;
        playback.load(source, Math.max(0, positionMs));
        loaded = true;
        playback.setVideoVisible(visible);
        if (!visible && !continueInBackground) playback.pause();
        return true;
    }

    void setVisibility(boolean activityVisible, boolean pictureInPicture) {
        boolean nextVisible = activityVisible || pictureInPicture;
        if (visible == nextVisible) return;
        visible = nextVisible;
        playback.setVideoVisible(visible);
        if (!visible && !continueInBackground) playback.pause();
    }

    void setContinueInBackground(boolean enabled) {
        if (continueInBackground == enabled) return;
        continueInBackground = enabled;
        if (!visible && !enabled) playback.pause();
    }

    void release(String candidate) {
        if (isOwner(candidate)) stop();
    }

    void clear() {
        stop();
        owner = null;
    }

    private void stop() {
        if (!loaded) return;
        loaded = false;
        playback.stop();
    }
}
