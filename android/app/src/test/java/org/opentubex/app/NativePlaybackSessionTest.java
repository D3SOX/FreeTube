package org.opentubex.app;

import static org.junit.Assert.*;

import org.junit.Test;

public class NativePlaybackSessionTest {
    private static final class Playback implements NativePlaybackSession.Playback {
        int loads;
        int pauses;
        int stops;
        boolean visible = true;

        @Override public void load(String source, long positionMs) { loads++; }
        @Override public void pause() { pauses++; }
        @Override public void stop() { stops++; }
        @Override public void setVideoVisible(boolean value) { visible = value; }
    }

    @Test
    public void backgroundAndPictureInPictureTransitionsKeepTheLoadedSource() {
        Playback playback = new Playback();
        NativePlaybackSession session = new NativePlaybackSession(playback);
        session.setOwner("video-tab");
        assertTrue(session.load("video-tab", "media-source", 42000));
        session.setVisibility(false, true);
        assertTrue(playback.visible);
        session.setVisibility(false, false);
        assertFalse(playback.visible);
        session.setVisibility(true, false);
        assertTrue(playback.visible);
        assertEquals(1, playback.loads);
        assertEquals(0, playback.pauses);
        assertEquals(0, playback.stops);
    }

    @Test
    public void optingOutPausesWhenTheLastVideoSurfaceIsHidden() {
        Playback playback = new Playback();
        NativePlaybackSession session = new NativePlaybackSession(playback);
        session.setOwner("video-tab");
        session.load("video-tab", "media-source", 0);
        session.setContinueInBackground(false);
        session.setVisibility(false, true);
        assertEquals(0, playback.pauses);
        session.setVisibility(false, false);
        assertEquals(1, playback.pauses);
        assertFalse(session.canPlay("video-tab"));
        session.setVisibility(true, false);
        assertTrue(session.canPlay("video-tab"));
        assertEquals(1, playback.loads);
        assertEquals(1, playback.pauses);
    }

    @Test
    public void changingTheSettingWhileHiddenAppliesImmediately() {
        Playback playback = new Playback();
        NativePlaybackSession session = new NativePlaybackSession(playback);
        session.setVisibility(false, false);
        session.setContinueInBackground(false);
        assertEquals(1, playback.pauses);
        session.setContinueInBackground(true);
        assertEquals(1, playback.pauses);
        assertEquals(0, playback.loads);
    }

    @Test
    public void aHiddenTabCannotReplaceOrReleaseThePresentedTabsSource() {
        Playback playback = new Playback();
        NativePlaybackSession session = new NativePlaybackSession(playback);
        session.setOwner("first");
        session.load("first", "source-1", 0);
        session.setOwner("second");
        assertEquals(1, playback.stops);
        assertTrue(session.load("second", "source-2", 0));
        assertFalse(session.load("first", "stale-source", 0));
        session.release("first");
        assertEquals(2, playback.loads);
        assertEquals(1, playback.stops);
        session.release("second");
        assertEquals(2, playback.stops);
    }

    @Test
    public void taskRemovalRevokesOwnershipAndCannotResumeFromStaleCommands() {
        Playback playback = new Playback();
        NativePlaybackSession session = new NativePlaybackSession(playback);
        session.setOwner("owner");
        session.load("owner", "source", 0);
        session.clear();
        assertFalse(session.canPlay("owner"));
        assertFalse(session.load("owner", "source", 42000));
        assertFalse(session.isOwner("owner"));
        assertEquals(1, playback.stops);
        assertEquals(1, playback.loads);
    }
}
