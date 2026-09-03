// src/utils/notificationPermission.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/NotificationPermissionPlugin.java
// — requests POST_NOTIFICATIONS (Android 13+) so the media-session
// foreground service's notification (and the lock-screen/notification-
// shade controls riding on it) actually has permission to show. Never
// throws — a denial just means no notification, not a broken app.
import { registerPlugin } from "@capacitor/core";

const NotificationPermission = registerPlugin("NotificationPermission");

export async function ensureNotificationPermission() {
  try {
    const status = await NotificationPermission.checkPermissions();
    if (status.notifications === "granted") return true;
    const requested = await NotificationPermission.requestPermissions();
    return requested.notifications === "granted";
  } catch {
    return false;
  }
}
