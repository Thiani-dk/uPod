package com.katiso.upod;

import android.Manifest;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

// POST_NOTIFICATIONS (Android 13+) is a runtime-dangerous permission like
// storage — without it granted, the media-session foreground service's
// notification (and the lock-screen/notification-shade controls that ride
// on it) may simply never show. Nothing in this app declared or requested
// it before. No method bodies needed: Plugin's own checkPermissions()/
// requestPermissions() (from the "notifications" alias below) already do
// the real work — same idiom @capacitor/filesystem uses for its
// "publicStorage" alias, which ensureStoragePermission() already calls.
@CapacitorPlugin(
    name = "NotificationPermission",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NotificationPermissionPlugin extends Plugin {}
