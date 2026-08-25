package com.katiso.upod;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

// Fills a gap the media-session plugin doesn't cover: Android sends
// ACTION_AUDIO_BECOMING_NOISY whenever audio is about to switch to a route
// a bystander could hear (most commonly: wired headphones unplugged) —
// unrelated to audio focus or MediaSession, and not something any media
// notification/hardware-button plugin registers on an app's behalf. Every
// well-behaved media app is expected to listen for this itself and pause.
@CapacitorPlugin(name = "NoisyAudio")
public class NoisyAudioPlugin extends Plugin {

    private static final String EVENT_NOISY = "noisy";

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                notifyListeners(EVENT_NOISY, new JSObject());
            }
        }
    };

    @Override
    public void load() {
        // NOT_EXPORTED: this is a protected, system-only broadcast — no
        // other app can send it, so it doesn't need to accept intents from
        // outside the device. Required explicitly on API 33+, where a
        // context-registered receiver without either flag throws.
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException ex) {
            // Already unregistered — nothing to do.
        }
    }
}
