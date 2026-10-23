// src/download/qualityPresets.js
// The choices offered when a link is shared into uPod.
//
// These are deliberately honest about a thing that is easy to get wrong.
// YouTube and Instagram do not serve lossless audio to anybody: the
// ceiling is roughly a 128-160 kbps Opus stream (YouTube itag 251), a
// 128 kbps AAC stream (itag 140), or ~256 kbps AAC for a Premium
// account. Instagram is ~128 kbps AAC. So "320 kbps MP3" is NOT a
// higher-quality download — it is the same ~128 kbps source re-encoded
// into a bigger file, and re-encoding one lossy codec into another only
// ever loses more. It is kept as an option because some car stereos and
// older players genuinely only read MP3, which is a real reason to want
// it; the `sub` copy says so rather than letting the big number imply
// fidelity it cannot deliver.
//
// `format` and `recode` are yt-dlp concepts: `format` is a -f selector
// picking which stream to pull, `recode` is a post-download transcode
// (none means the original stream is kept byte-for-byte).

export const AUDIO_QUALITY_PRESETS = [
  {
    id: "best",
    label: "Best available",
    sub: "Original stream, never re-encoded. The best the platform actually serves.",
    recommended: true,
    format: "bestaudio/best",
    recode: null,
  },
  {
    id: "m4a",
    label: "M4A / AAC",
    sub: "Original AAC where offered, still no re-encode. Plays on anything.",
    format: "bestaudio[ext=m4a]/bestaudio/best",
    recode: null,
  },
  {
    id: "mp3-320",
    label: "MP3 · 320 kbps",
    sub: "For players that read nothing else. Bigger than the source, not better.",
    format: "bestaudio/best",
    recode: { codec: "mp3", bitrate: "320k" },
  },
  {
    id: "mp3-192",
    label: "MP3 · 192 kbps",
    sub: "Same re-encode, about half the size.",
    format: "bestaudio/best",
    recode: { codec: "mp3", bitrate: "192k" },
  },
  {
    id: "smallest",
    label: "Smallest file",
    sub: "Lowest bitrate on offer. Fine for talk, rough on music.",
    format: "worstaudio/bestaudio/best",
    recode: null,
  },
];

export const DEFAULT_PRESET_ID = "best";

// Just for the modal's header line — enough to tell a YouTube share from
// an Instagram one at a glance, without pretending to be a full parser.
export function describeSource(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com)$/.test(host)) return "YouTube";
    if (/(^|\.)instagram\.com$/.test(host)) return "Instagram";
    if (/(^|\.)(soundcloud\.com)$/.test(host)) return "SoundCloud";
    if (/(^|\.)(spotify\.com|spotify\.link)$/.test(host)) return "Spotify";
    return host;
  } catch {
    return "this link";
  }
}
