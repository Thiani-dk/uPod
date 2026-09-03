package com.katiso.upod;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// "All files access" (MANAGE_EXTERNAL_STORAGE, API 30+) is what actually
// governs whether scanNativeFolder() can read an arbitrary user-chosen
// shared-storage folder — @capacitor/filesystem's "publicStorage" alias
// only covers READ/WRITE_EXTERNAL_STORAGE, which this app also declares
// but which scoped storage on API 30+ mostly ignores for that purpose.
// Confirmed by reading capacitor/filesystem's own plugin source (its
// @CapacitorPlugin permissions list has no MANAGE_EXTERNAL_STORAGE
// entry) — without this, ensureStoragePermission() could report success
// on a fresh install/reinstall while the real permission the scan needs
// was never granted, producing a silent empty library with no
// explanation. Unlike a normal dangerous permission, this one can't be
// granted through a runtime-permission dialog at all — only through the
// dedicated Settings screen openSettings() deep-links to.
@CapacitorPlugin(name = "AllFilesAccess")
public class AllFilesAccessPlugin extends Plugin {

    // Resolves { granted, applicable }. `applicable` is false below API
    // 30, where MANAGE_EXTERNAL_STORAGE doesn't exist and the legacy
    // runtime-permission model is what actually governs access instead —
    // callers (see ensureStoragePermission in nativeFolder.js) fall back
    // to that check themselves when this is false, rather than this
    // method papering over the distinction with an unconditional true.
    @PluginMethod
    public void check(PluginCall call) {
        boolean applicable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        boolean granted = !applicable || Environment.isExternalStorageManager();
        JSObject ret = new JSObject();
        ret.put("applicable", applicable);
        ret.put("granted", granted);
        call.resolve(ret);
    }

    // Deep-links straight to this app's own "All files access" toggle.
    // Falls back to the general management list if the per-app screen
    // isn't resolvable on this OEM/version — uPod can still be found and
    // toggled manually from there.
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getContext().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            try {
                getContext().startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            } catch (ActivityNotFoundException ignored) {
                call.reject("Couldn't open Settings on this device.");
                return;
            }
        }
        call.resolve();
    }
}
