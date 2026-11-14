// scripts/fetch-ytdlp.mjs
// Fetches the standalone yt-dlp build into ./bin. It's a self-contained
// binary, so this needs neither root nor a system Python — which matters
// because the laptop has neither yt-dlp nor ffmpeg installed, and
// ffmpeg arrives separately as the ffmpeg-static dependency.
import { createWriteStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.resolve(here, "..", "bin");

const ASSET = {
  linux: "yt-dlp_linux",
  darwin: "yt-dlp_macos",
  win32: "yt-dlp.exe",
}[process.platform];

if (!ASSET) {
  console.error(`No yt-dlp build for platform ${process.platform}`);
  process.exit(1);
}

const target = path.join(BIN_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;

await mkdir(BIN_DIR, { recursive: true });

console.log(`Fetching ${url}`);
const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(target));
await chmod(target, 0o755);

const { size } = await stat(target);
console.log(`yt-dlp installed at ${target} (${(size / 1e6).toFixed(1)} MB)`);
