package com.katiso.upod;

import android.content.Context;
import android.os.PowerManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Cheap insurance, not a confirmed-necessary fix: it's unverified whether
// Chromium's WebView media pipeline already holds its own wake lock for
// background <audio> decode with the screen off, and that's not something
// this app can inspect or control. Mature native players (e.g. ExoPlayer's
// C.WAKE_MODE_LOCAL) hold an explicit PARTIAL_WAKE_LOCK for the duration of
// playback regardless of what the underlying decoder does internally —
// this mirrors that, tied to PlayerContext's state.playing.
@CapacitorPlugin(name = "PlaybackWakeLock")
public class PlaybackWakeLockPlugin extends Plugin {

    // Safety net only, per Android's own PowerManager docs guidance on
    // always using a timeout — normal operation always pairs acquire()
    // with a release() when state.playing goes false (see PlayerContext.jsx),
    // so this should never actually get hit in practice.
    private static final long SAFETY_TIMEOUT_MS = 10 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void load() {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "uPod:Playback");
        wakeLock.setReferenceCounted(false);
    }

    // Unconditional acquire (not gated on isHeld()) — re-acquiring an
    // already-held timed WakeLock just refreshes its timeout, which is
    // exactly what PlayerContext.jsx wants when it calls this again on
    // every track change during one long continuous playback session.
    @PluginMethod
    public void acquire(PluginCall call) {
        if (wakeLock != null) {
            wakeLock.acquire(SAFETY_TIMEOUT_MS);
        }
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }
}
