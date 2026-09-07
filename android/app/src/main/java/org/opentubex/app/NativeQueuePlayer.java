package org.opentubex.app;

import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import java.util.HashSet;
import java.util.Set;

/** Routes native previous/next controls to Watch's queue and playlist handlers. */
final class NativeQueuePlayer extends ForwardingPlayer {
    private final Set<Player.Listener> listeners = new HashSet<>();
    private boolean previous;
    private boolean next;
    private long seekIncrementMs = 10000;
    private boolean scaleSeekWithRate;

    NativeQueuePlayer(Player player) { super(player); }

    void setActions(Set<String> actions) {
        boolean canPrevious = actions.contains(AndroidMediaActions.PREVIOUS);
        boolean canNext = actions.contains(AndroidMediaActions.NEXT);
        if (previous == canPrevious && next == canNext) return;
        previous = canPrevious;
        next = canNext;
        for (Player.Listener listener : new HashSet<>(listeners)) {
            listener.onAvailableCommandsChanged(getAvailableCommands());
            listener.onEvents(this, new Player.Events(new androidx.media3.common.FlagSet.Builder()
                .add(EVENT_AVAILABLE_COMMANDS_CHANGED).build()));
        }
    }

    void setSeekPreferences(double seconds, boolean scaleWithRate) {
        seekIncrementMs = Math.round(seconds * 1000);
        scaleSeekWithRate = scaleWithRate;
        for (Player.Listener listener : new HashSet<>(listeners)) {
            listener.onSeekBackIncrementChanged(getSeekBackIncrement());
            listener.onSeekForwardIncrementChanged(getSeekForwardIncrement());
            listener.onEvents(this, new Player.Events(new androidx.media3.common.FlagSet.Builder()
                .add(EVENT_SEEK_BACK_INCREMENT_CHANGED).add(EVENT_SEEK_FORWARD_INCREMENT_CHANGED).build()));
        }
    }

    @Override public long getSeekBackIncrement() {
        return Math.round(seekIncrementMs * (scaleSeekWithRate ? getPlaybackParameters().speed : 1));
    }
    @Override public long getSeekForwardIncrement() { return getSeekBackIncrement(); }
    @Override public void seekBack() { seekTo(Math.max(0, getCurrentPosition() - getSeekBackIncrement())); }
    @Override public void seekForward() { seekTo(getCurrentPosition() + getSeekForwardIncrement()); }

    @Override public void addListener(Player.Listener listener) {
        listeners.add(listener);
        super.addListener(listener);
    }

    @Override public void removeListener(Player.Listener listener) {
        listeners.remove(listener);
        super.removeListener(listener);
    }

    @Override public Player.Commands getAvailableCommands() {
        return super.getAvailableCommands().buildUpon()
            .remove(COMMAND_SEEK_TO_PREVIOUS).remove(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .remove(COMMAND_SEEK_TO_NEXT).remove(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .addIf(COMMAND_SEEK_TO_PREVIOUS, previous)
            .addIf(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, previous)
            .addIf(COMMAND_SEEK_TO_NEXT, next)
            .addIf(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, next).build();
    }

    @Override public boolean isCommandAvailable(int command) {
        return getAvailableCommands().contains(command);
    }

    @Override public void seekToNext() {
        if (next) AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.NEXT);
    }
    @Override public void seekToNextMediaItem() { seekToNext(); }
    @Override public void seekToPrevious() {
        if (previous) AndroidMediaSessionPlugin.emitAction(AndroidMediaActions.PREVIOUS);
    }
    @Override public void seekToPreviousMediaItem() { seekToPrevious(); }
}
