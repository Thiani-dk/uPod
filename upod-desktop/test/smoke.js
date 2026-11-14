// test/smoke.js
// Exercises the desktop shims against the real library, using the phone
// app's own modules — if these pass, the port is doing its job for the
// paths that matter: scanning, tag reading, playback byte-loading,
// preferences and the download engine.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { scanNativeFolder, readNativeTrackObjectUrl, DEFAULT_MUSIC_FOLDER } from "@app/audio/nativeFolder.js";
import { searchYouTube, prepareEngine, downloadAudio, newDownloadId } from "@app/download/audioDownload.js";
import { AUDIO_QUALITY_PRESETS } from "@app/download/qualityPresets.js";

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};

async function run() {
  try {
    log("isNativePlatform", Capacitor.isNativePlatform() === true, `platform=${Capacitor.getPlatform()}`);

    // Directory listing through the Filesystem shim.
    const dir = await Filesystem.readdir({ path: DEFAULT_MUSIC_FOLDER, directory: Directory.ExternalStorage });
    log("readdir", dir.files.length > 0, `${dir.files.length} entries in ${DEFAULT_MUSIC_FOLDER}`);

    // Partial read — the thing the whole scan speed depends on.
    const firstFile = dir.files.find((f) => f.type === "file" && /\.(mp3|opus|m4a|flac)$/i.test(f.name));
    const part = await Filesystem.readFile({
      path: `${DEFAULT_MUSIC_FOLDER}/${firstFile.name}`,
      directory: Directory.ExternalStorage,
      offset: 0,
      length: 1024,
    });
    const partBytes = atob(part.data).length;
    log("partial readFile", partBytes === 1024, `asked 1024 bytes, got ${partBytes} of "${firstFile.name}"`);

    // Preferences round-trip.
    await Preferences.set({ key: "upod_smoke", value: "hello" });
    const got = await Preferences.get({ key: "upod_smoke" });
    await Preferences.remove({ key: "upod_smoke" });
    const after = await Preferences.get({ key: "upod_smoke" });
    log("preferences", got.value === "hello" && after.value === null, `set/get/remove round-trip`);

    // The real library scan, through the app's own code.
    const t0 = performance.now();
    let lastProgress = 0;
    const scan = await scanNativeFolder((done) => {
      lastProgress = done;
    });
    const ms = Math.round(performance.now() - t0);
    log("scanNativeFolder", scan.tracks.length > 0, `${scan.tracks.length} tracks in ${ms}ms (progress reached ${lastProgress})`);

    // Tags actually parsed, not just filenames.
    const tagged = scan.tracks.filter((t) => t.title && t.artist && t.artist !== "Unknown Artist");
    log("tag parsing", tagged.length > 0, `${tagged.length}/${scan.tracks.length} tracks have artist+title tags`);
    const sample = scan.tracks.slice(0, 3).map((t) => `${t.artist} — ${t.title}`).join(" / ");
    log("sample tracks", true, sample);

    // Full byte load for playback, and prove the blob decodes.
    const track = scan.tracks.find((t) => /\.mp3$/i.test(t.relativePath)) || scan.tracks[0];
    const url = await readNativeTrackObjectUrl({ folderPath: scan.folderPath, relativePath: track.relativePath });
    const audio = new Audio();
    audio.src = url;
    const duration = await new Promise((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(audio.duration));
      audio.addEventListener("error", () => reject(new Error("decode failed")));
      setTimeout(() => reject(new Error("timeout")), 10000);
    });
    log("audio decode", duration > 0, `"${track.title}" decoded, duration ${duration.toFixed(1)}s`);

    // Download engine present and able to reach YouTube.
    await prepareEngine();
    const hits = await searchYouTube("rick astley never gonna give you up", 2);
    log("yt-dlp search", hits.length > 0, hits.length ? `top hit: "${hits[0].title}"` : "no results");
    // A real download, start to finish, through the same call the share
    // sheet makes. Big Buck Bunny is Creative Commons and short, so the
    // test neither takes long nor leans on anyone's rights.
    if (import.meta.env.VITE_SMOKE_DOWNLOAD === "1") {
      const preset = AUDIO_QUALITY_PRESETS.find((p) => p.id === "best");
      const id = newDownloadId();
      let sawProgress = false;
      const outcome = await new Promise((resolve) => {
        downloadAudio(
          id,
          "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          preset,
          {
            onProgress: () => {
              sawProgress = true;
            },
            onDone: (ev) => resolve({ ok: true, ev }),
            onFailed: (ev) => resolve({ ok: false, ev }),
          },
          { outputName: "upod-smoke-test" }
        ).catch((err) => resolve({ ok: false, ev: { error: err.message } }));
        setTimeout(() => resolve({ ok: false, ev: { error: "timed out after 180s" } }), 180000);
      });
      log(
        "download end-to-end",
        outcome.ok,
        outcome.ok
          ? `saved ${outcome.ev.path} (progress events: ${sawProgress})`
          : `${outcome.ev.error}`
      );
    }
  } catch (err) {
    log("UNCAUGHT", false, `${err?.message || err}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`SMOKE_SUMMARY ${results.length - failed.length}/${results.length} passed`);
  console.log("SMOKE_DONE");
}

run();
