package com.katiso.upod;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NoisyAudioPlugin.class);
        registerPlugin(AudioFocusPlugin.class);
        registerPlugin(NotificationPermissionPlugin.class);
        registerPlugin(PlaybackWakeLockPlugin.class);
        registerPlugin(AllFilesAccessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
