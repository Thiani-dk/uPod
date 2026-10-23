package com.katiso.upod;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import com.yausername.ffmpeg.FFmpeg;
import kotlin.Unit;
import kotlin.jvm.functions.Function3;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// The download half of the share-to-uPod flow: ShareTargetPlugin catches
// the link, the JS picker asks which quality, and this runs yt-dlp to
// actually fetch the audio.
//
// yt-dlp here is the real thing — a bundled CPython running the actual
// yt-dlp sources (io.github.junkfood02.youtubedl-android), not a
// reimplementation — which is why it keeps working across the extractor
// changes YouTube makes every few weeks, and why update() below matters
// as much as it does.
@CapacitorPlugin(name = "AudioDownload")
public class AudioDownloadPlugin extends Plugin {

    private static final String EVENT_PROGRESS = "progress";
    private static final String EVENT_DONE = "done";
    private static final String EVENT_FAILED = "failed";

    // Single thread, so two shares in quick succession queue rather than
    // fighting each other for bandwidth and CPU on a phone.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private boolean engineReady = false;

    private static final String CHANNEL_ID = "upod_downloads";
    // Rebuilding a notification on every yt-dlp progress line (several a
    // second) is enough posting traffic for Android to start dropping
    // updates and for the shade to visibly stutter, so updates are
    // rate-limited per job.
    private static final long NOTIFY_MIN_INTERVAL_MS = 700L;
    private final java.util.Map<String, Long> lastNotifyAt = new java.util.concurrent.ConcurrentHashMap<>();

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        // LOW: a download is worth showing, never worth a sound or a
        // heads-up banner over whatever the user is actually doing.
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Progress for audio saved from a shared link");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    // One notification per job, keyed by a stable hash of the job id.
    private int notificationIdFor(String jobId) {
        return ("upod-dl-" + jobId).hashCode();
    }

    private void postNotification(String jobId, String title, String text, Integer percent, boolean ongoing, boolean indeterminate) {
        try {
            ensureChannel();

            Intent open = new Intent(getContext(), MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent tap = PendingIntent.getActivity(
                getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setSmallIcon(ongoing
                    ? android.R.drawable.stat_sys_download
                    : android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(tap)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(ongoing)
                .setAutoCancel(!ongoing);

            if (ongoing) {
                builder.setProgress(100, percent == null ? 0 : percent, indeterminate);
            }

            NotificationManagerCompat.from(getContext()).notify(notificationIdFor(jobId), builder.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted (API 33+). The in-app dock
            // still reports everything, so this is not worth failing the
            // download over.
        }
    }

    // First call unpacks ~50 MB of Python and ffmpeg out of the APK into
    // app storage, which takes a few seconds — far too slow for the UI
    // thread, hence every caller going through the worker.
    private synchronized void ensureEngine() throws Exception {
        if (engineReady) return;
        YoutubeDL.getInstance().init(getContext());
        FFmpeg.getInstance().init(getContext());
        engineReady = true;
    }

    // Lets the UI pay the unpack cost at a moment of its choosing (e.g.
    // while the quality sheet is open) instead of it landing on the
    // front of the first download.
    @PluginMethod
    public void prepare(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureEngine();
                call.resolve();
            } catch (Exception e) {
                call.reject(describe(e), e);
            }
        });
    }

    // Pulls a newer yt-dlp at runtime. Not optional housekeeping: YouTube
    // changes its player/extractor often enough that a months-old yt-dlp
    // reliably starts failing, and the bundled copy is only as fresh as
    // the APK build.
    @PluginMethod
    public void update(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureEngine();
                YoutubeDL.UpdateStatus status =
                    YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel._STABLE);
                JSObject ret = new JSObject();
                ret.put("status", status == null ? "UNKNOWN" : status.toString());
                ret.put("version", YoutubeDL.getInstance().version(getContext()));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(describe(e), e);
            }
        });
    }

    // Runs a YouTube search and returns the candidates as raw JSON
    // lines, without downloading anything. This is what makes a Spotify
    // link work: Spotify's own audio is DRM-encrypted and yt-dlp has no
    // extractor for it, so the only honest route is to take the track's
    // name/artist/duration from Spotify and find that same recording on
    // YouTube. Scoring the candidates is left to the JS side, which can
    // compare them against the Spotify duration and show the user what
    // it settled on.
    @PluginMethod
    public void search(PluginCall call) {
        final String query = call.getString("query");
        final int limit = call.getInt("limit", 5);
        if (query == null || query.trim().isEmpty()) {
            call.reject("A search query is required.");
            return;
        }

        worker.execute(() -> {
            try {
                ensureEngine();
                YoutubeDLRequest request = new YoutubeDLRequest("ytsearch" + limit + ":" + query);
                // --flat-playlist keeps this to one cheap search request
                // instead of a full extraction per candidate, which for
                // five results is the difference between about a second
                // and about ten.
                request.addOption("--flat-playlist");
                request.addOption("--dump-json");
                request.addOption("--no-warnings");

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);

                JSArray results = new JSArray();
                String out = response.getOut();
                if (out != null) {
                    for (String line : out.split("\n")) {
                        String trimmed = line.trim();
                        if (trimmed.startsWith("{")) results.put(trimmed);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("results", results);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(describe(e), e);
            }
        });
    }

    // Resolves as soon as the job is queued, not when it finishes —
    // progress and the final result arrive as events, keyed by the
    // caller's `id`, so the sheet can close immediately and the download
    // reports into a progress strip instead of blocking the UI.
    @PluginMethod
    public void start(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        final String directory = call.getString("directory");
        final String format = call.getString("format", "bestaudio/best");
        final JSObject recode = call.getObject("recode");
        // Set for a Spotify match, where the right name is the one
        // Spotify gave us ("Rick Astley - Never Gonna Give You Up"),
        // not the YouTube upload's title ("...(Official Video) [HD]").
        final String outputName = call.getString("outputName");

        if (id == null || url == null || directory == null) {
            call.reject("id, url and directory are all required.");
            return;
        }
        call.resolve();

        worker.execute(() -> run(id, url, directory, format, recode, outputName));
    }

    private void run(String id, String url, String directory, String format, JSObject recode, String outputName) {
        try {
            ensureEngine();

            File dir = new File(directory);
            if (!dir.isDirectory() && !dir.mkdirs()) {
                fail(id, "Couldn't create the download folder: " + directory);
                return;
            }

            YoutubeDLRequest request = new YoutubeDLRequest(url);
            request.addOption("-f", format);
            // -x discards any video stream. With "--audio-format best"
            // it is a remux, not a re-encode: the original Opus/AAC
            // bytes are moved into an audio container untouched. Only
            // the explicit MP3 presets below ask ffmpeg to actually
            // transcode, and they say so in the picker.
            request.addOption("-x");
            if (recode != null && recode.getString("codec") != null) {
                request.addOption("--audio-format", recode.getString("codec"));
                String bitrate = recode.getString("bitrate");
                if (bitrate != null) request.addOption("--audio-quality", bitrate);
            } else {
                request.addOption("--audio-format", "best");
            }

            // Title/artist/date into the file's own tags, so the track
            // arrives in the library already describing itself rather
            // than as "dQw4w9WgXcQ" with everything blank.
            request.addOption("--embed-metadata");
            // Keeps the video id in the name: two different uploads of
            // the same song would otherwise collide on title alone.
            // uPod's own scan reads "Artist - Title" filenames, so a
            // Spotify match lands under the name the user actually
            // searched for. Everything else keeps the video id, because
            // two uploads of the same song would otherwise collide.
            String template = outputName != null && !outputName.trim().isEmpty()
                ? sanitizeName(outputName) + ".%(ext)s"
                : "%(title)s [%(id)s].%(ext)s";
            request.addOption("-o", new File(dir, template).getAbsolutePath());
            // Without this the file carries YouTube's upload date as its
            // mtime, which scatters new downloads through a
            // date-sorted library instead of landing them at the top.
            request.addOption("--no-mtime");
            // Printed on its own line once the file is in its final
            // place — the only reliable way to learn the real filename
            // after yt-dlp's own templating and extension choice.
            request.addOption("--print", "after_move:filepath");
            request.addOption("--no-simulate");

            // The progress callback is a Kotlin Function3, not a Java
            // functional interface, so it can't be written as a lambda
            // from here — hence the explicit anonymous class and the
            // Unit.INSTANCE return.
            final String notifyTitle = outputName != null && !outputName.trim().isEmpty()
                ? outputName
                : "Saving audio";
            postNotification(id, notifyTitle, "Starting…", 0, true, true);

            YoutubeDLResponse response = YoutubeDL.getInstance().execute(
                request,
                id,
                new Function3<Float, Long, String, Unit>() {
                    @Override
                    public Unit invoke(Float progress, Long etaSeconds, String line) {
                        JSObject payload = new JSObject();
                        payload.put("id", id);
                        payload.put("percent", progress);
                        payload.put("etaSeconds", etaSeconds);
                        payload.put("line", line);
                        notifyListeners(EVENT_PROGRESS, payload);

                        long now = System.currentTimeMillis();
                        Long last = lastNotifyAt.get(id);
                        if (last == null || now - last >= NOTIFY_MIN_INTERVAL_MS) {
                            lastNotifyAt.put(id, now);
                            boolean unknown = progress == null || progress < 0;
                            postNotification(
                                id,
                                notifyTitle,
                                unknown ? "Downloading…" : Math.round(progress) + "%",
                                unknown ? 0 : Math.round(progress),
                                true,
                                unknown
                            );
                        }
                        return Unit.INSTANCE;
                    }
                }
            );

            String path = lastPathIn(response.getOut(), dir.getAbsolutePath());
            lastNotifyAt.remove(id);
            postNotification(id, notifyTitle, "Saved to your music folder", null, false, false);

            JSObject payload = new JSObject();
            payload.put("id", id);
            payload.put("path", path);
            notifyListeners(EVENT_DONE, payload);
        } catch (Exception e) {
            lastNotifyAt.remove(id);
            String message = describe(e);
            postNotification(id, "Download failed", message, null, false, false);
            fail(id, message);
        }
    }

    // Picks the "after_move:filepath" line out of yt-dlp's chatter. It is
    // matched by the directory prefix rather than by position, because
    // progress and postprocessor lines share the same stream; the last
    // match wins, which is the finished file after any MP3 re-encode
    // rather than the intermediate the encode consumed.
    private String lastPathIn(String out, String dirPrefix) {
        if (out == null) return null;
        String found = null;
        for (String line : out.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith(dirPrefix)) found = trimmed;
        }
        return found;
    }

    // Strips what a filename can't carry (and the % that would be read
    // as an output-template field), so a track title with a slash or a
    // colon in it can't break the path or smuggle in a directory.
    private String sanitizeName(String name) {
        String cleaned = name.replaceAll("[/\\\\:*?\"<>|%]", "_").trim();
        if (cleaned.length() > 150) cleaned = cleaned.substring(0, 150).trim();
        return cleaned.isEmpty() ? "download" : cleaned;
    }

    private void fail(String id, String message) {
        JSObject payload = new JSObject();
        payload.put("id", id);
        payload.put("message", message);
        notifyListeners(EVENT_FAILED, payload);
    }

    // yt-dlp's own error text is long and Python-flavoured, but its last
    // non-empty line is usually the one sentence a person can act on
    // ("Video unavailable", "Sign in to confirm your age"), so that is
    // what gets surfaced.
    private String describe(Exception e) {
        String message = e.getMessage();
        if (message == null || message.isEmpty()) return e.getClass().getSimpleName();
        String[] lines = message.split("\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String candidate = lines[i].trim();
            if (!candidate.isEmpty()) return candidate;
        }
        return message;
    }
}
