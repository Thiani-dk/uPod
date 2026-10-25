package com.katiso.upod;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import java.util.LinkedHashMap;
import java.util.Map;

// Keeps a download alive while uPod is not the app on screen.
//
// The downloads themselves run on AudioDownloadPlugin's executor, in
// this same process — which is exactly the problem this solves. A
// process with no visible activity and nothing else holding it up is a
// cached process, and Android reclaims those freely under memory
// pressure; an album download is minutes of work, and the user putting
// their phone in their pocket is the normal case rather than the
// exceptional one. Observed consequence before this: a long download
// that simply stopped, with a progress notification frozen at whatever
// percentage it had reached.
//
// A foreground service is the sanctioned way to say "this process is
// doing something the user asked for and can see". It does not make the
// process unkillable — aggressive OEM task killers are their own
// problem (see the background-playback guidance in Settings, which is
// the same fight) — but it moves the process out of the first tier
// Android reaches for.
//
// It also takes over the progress notification. A foreground service
// must post one anyway, and two notifications counting the same
// download up to 100% would be absurd, so the plugin hands its progress
// reporting over here for the life of the job and keeps only the
// final "saved"/"failed" message, which is posted after this is gone.
public class DownloadForegroundService extends Service {

    static final String ACTION_START = "com.katiso.upod.download.START";
    static final String ACTION_UPDATE = "com.katiso.upod.download.UPDATE";
    static final String ACTION_STOP = "com.katiso.upod.download.STOP";

    private static final String EXTRA_JOB_ID = "jobId";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_TEXT = "text";
    private static final String EXTRA_PERCENT = "percent";
    private static final String EXTRA_INDETERMINATE = "indeterminate";

    // Deliberately not AudioDownloadPlugin's per-job id space: this is
    // one notification for the whole queue, not one per download.
    private static final int NOTIFICATION_ID = 0x7D0C;
    private static final String CHANNEL_ID = "upod_downloads";

    // Insertion-ordered so "the job being reported on" is the oldest one
    // still running — the one the user started first and is waiting for
    // — rather than whichever happened to update last.
    private final Map<String, JobState> jobs = new LinkedHashMap<>();

    private static class JobState {
        String title;
        String text = "Starting…";
        int percent = 0;
        boolean indeterminate = true;

        JobState(String title) {
            this.title = title;
        }
    }

    // --- the API the plugin actually calls -------------------------------

    static void startJob(Context context, String jobId, String title) {
        Intent intent = new Intent(context, DownloadForegroundService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_JOB_ID, jobId)
            .putExtra(EXTRA_TITLE, title);
        deliver(context, intent);
    }

    static void updateJob(Context context, String jobId, String text, int percent, boolean indeterminate) {
        Intent intent = new Intent(context, DownloadForegroundService.class)
            .setAction(ACTION_UPDATE)
            .putExtra(EXTRA_JOB_ID, jobId)
            .putExtra(EXTRA_TEXT, text)
            .putExtra(EXTRA_PERCENT, percent)
            .putExtra(EXTRA_INDETERMINATE, indeterminate);
        deliver(context, intent);
    }

    static void stopJob(Context context, String jobId) {
        Intent intent = new Intent(context, DownloadForegroundService.class)
            .setAction(ACTION_STOP)
            .putExtra(EXTRA_JOB_ID, jobId);
        deliver(context, intent);
    }

    // startForegroundService is required from API 26 up, and carries a
    // hard contract: startForeground() within five seconds or the system
    // kills the process with an ANR-like crash. onStartCommand below
    // satisfies it on every branch, including the ones that immediately
    // stop again.
    //
    // It can also throw outright: from Android 12, a service can't be
    // started into the foreground while the app is in the background.
    // uPod only ever starts one from a download the user just asked for,
    // with the app on screen, but a queued job and a race against the
    // last one finishing could in principle land outside that window —
    // and a download running without the protection is strictly better
    // than a download that crashes the app.
    private static void deliver(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.w("uPod", "Couldn't reach the download service: " + e.getMessage());
        }
    }

    // --- service lifecycle ------------------------------------------------

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        String jobId = intent == null ? null : intent.getStringExtra(EXTRA_JOB_ID);

        if (ACTION_START.equals(action) && jobId != null) {
            if (!jobs.containsKey(jobId)) {
                String title = intent.getStringExtra(EXTRA_TITLE);
                jobs.put(jobId, new JobState(title == null ? "Saving audio" : title));
            }
        } else if (ACTION_UPDATE.equals(action) && jobId != null) {
            JobState job = jobs.get(jobId);
            if (job != null) {
                job.text = intent.getStringExtra(EXTRA_TEXT);
                job.percent = intent.getIntExtra(EXTRA_PERCENT, 0);
                job.indeterminate = intent.getBooleanExtra(EXTRA_INDETERMINATE, false);
            }
        } else if (ACTION_STOP.equals(action) && jobId != null) {
            jobs.remove(jobId);
        }

        // Always, on every path — including a stray intent with no
        // recognised action, which would otherwise be a five-second fuse
        // on a crash. Promoting and immediately demoting is cheap; not
        // promoting at all is fatal.
        goForeground();

        if (jobs.isEmpty()) {
            stopForeground(true);
            stopSelf();
        }

        // A restart after the process was killed would bring back a
        // service with no downloads attached to it: yt-dlp's work lives
        // in the plugin's executor and does not survive, so there would
        // be nothing to resume and nothing to report.
        return START_NOT_STICKY;
    }

    private void goForeground() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ wants the type declared at promotion time,
                // and from Android 14 it must match the manifest's
                // foregroundServiceType — "dataSync" being the category a
                // user-initiated download falls under.
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            // Most likely the API 31+ background-start restriction, or
            // notifications being denied. The download carries on
            // regardless — it just loses this protection.
            android.util.Log.w("uPod", "Couldn't run the download in the foreground: " + e.getMessage());
        }
    }

    private Notification buildNotification() {
        ensureChannel();

        JobState first = jobs.isEmpty() ? null : jobs.values().iterator().next();
        int count = jobs.size();

        String title;
        String text;
        if (first == null) {
            // Only ever on the way out, in the moment between the last
            // job being removed and stopForeground below.
            title = "Finishing up";
            text = null;
        } else if (count > 1) {
            title = "Downloading " + count + " tracks";
            text = first.title;
        } else {
            title = first.title;
            text = first.text;
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true);

        if (first != null) {
            builder.setProgress(100, first.percent, first.indeterminate);
        }
        return builder.build();
    }

    // Same channel the plugin's own notifications use, created here too
    // because the service can be the first thing to post on it.
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Progress for audio saved from a shared link");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
