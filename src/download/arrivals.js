// src/download/arrivals.js
// The waiting room between "yt-dlp finished writing a file" and "the
// user has said what that file is".
//
// It exists because the two halves can be hours apart. A batch can
// finish with the phone in a pocket; the notification is tapped the next
// morning, possibly after the process has been killed and relaunched. So
// the list of what arrived lives in Preferences rather than in React
// state, keyed by the folder-relative paths that are also how the
// library identifies files.
//
// Only one batch is ever pending. A second batch finishing before the
// first was reviewed merges into it: both are "music that just arrived
// and hasn't been sorted", and two stacked review sheets would be a
// worse answer than one list.
import { Preferences } from "@capacitor/preferences";

const KEY = "upod_pending_arrivals";

export async function loadPendingArrivals() {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed?.paths?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function save(record) {
  try {
    await Preferences.set({ key: KEY, value: JSON.stringify(record) });
  } catch (err) {
    console.warn("Couldn't persist the pending arrivals:", err);
  }
}

// Adds freshly-downloaded files to the pending batch, returning the
// merged record. `sourceUrl` is kept so the review sheet can say where
// the music came from, and `playlist` (when the share was a playlist) is
// the obvious default album name to offer.
export async function addArrivals({ paths, sourceUrl, playlist }) {
  const existing = (await loadPendingArrivals()) || { at: Date.now(), paths: [], sourceUrl: null, playlist: null };
  const merged = {
    ...existing,
    at: Date.now(),
    // De-duplicated because a download that was retried, or a batch
    // finalised twice (see App.jsx), must not list the same track twice.
    paths: [...new Set([...existing.paths, ...paths])],
    sourceUrl: sourceUrl || existing.sourceUrl,
    playlist: playlist || existing.playlist,
  };
  await save(merged);
  return merged;
}

export async function clearPendingArrivals() {
  try {
    await Preferences.remove({ key: KEY });
  } catch {
    /* nothing to clear */
  }
}
