package com.katiso.upod;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Fills a gap the media-session plugin doesn't cover, and can't: Chromium's
// WebView <audio> element does not request Android audio focus on its own
// (a long-documented Chromium limitation, not something any JS-side
// MediaSession API surface touches) — without this, a phone call or
// another app's media would play right over uPod indefinitely instead of
// pausing/ducking it. Every well-behaved media app is expected to manage
// this itself; on plain android.webkit.WebView nothing does it for you.
@CapacitorPlugin(name = "AudioFocus")
public class AudioFocusPlugin extends Plugin {

    private static final String EVENT_FOCUS_CHANGE = "focuschange";

    private AudioManager audioManager;
    // Only used on API 26+ — abandonAudioFocusRequest() needs the exact
    // request object a later requestFocus() call built. Below API 26 the
    // legacy listener-based overloads are used for both request and
    // abandon instead.
    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener focusListener = this::handleFocusChange;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    // Forwards the raw AudioManager constants as a small set of JS-friendly
    // event types — PlayerContext.jsx decides what "loss"/"lossTransient"/
    // "duck"/"gain" actually mean for playback (pause vs. duck vs. resume),
    // this plugin only reports what Android told it.
    private void handleFocusChange(int focusChange) {
        String type;
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                type = "loss";
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                type = "lossTransient";
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                type = "duck";
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                type = "gain";
                break;
            default:
                return;
        }
        JSObject data = new JSObject();
        data.put("type", type);
        notifyListeners(EVENT_FOCUS_CHANGE, data);
    }

    @PluginMethod
    public void requestFocus(PluginCall call) {
        boolean granted = false;
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes)
                    .setOnAudioFocusChangeListener(focusListener)
                    .build();
                granted = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            } else {
                granted =
                    audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) ==
                    AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void abandonFocus(PluginCall call) {
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) {
                    audioManager.abandonAudioFocusRequest(focusRequest);
                }
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        }
        call.resolve();
    }
}
