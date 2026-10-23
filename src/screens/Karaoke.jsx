// src/screens/Karaoke.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { WifiOff, Sparkles, Save, Key, RefreshCw } from "lucide-react";
import { usePlayerState, usePlayerTime, usePlayerActions } from "../store/PlayerContext";
import {
  fetchLyricsOnline,
  saveManualLyrics,
  fetchLyricsFromGemini,
  getGeminiKey,
  setGeminiKey,
  parseSyncedLyrics,
  LYRICS_FAILURE,
} from "../online/lyrics";

// Each lookup failure reads differently on purpose. A genuine no-match is
// expected behaviour for an obscure or mistagged track and shouldn't be
// dressed up as a malfunction; a network or rate-limit failure is a
// temporary condition the user can actually do something about, and
// previously both rendered the same "the lookup failed" line.
const FAILURE_COPY = {
  [LYRICS_FAILURE.NOT_FOUND]: {
    title: "No lyrics found for this track",
    sub: "LRCLIB, lyrics.ovh and MusicBrainz were all asked, under several readings of this file's tags and filename, and none of them has this song. That's normal for obscure releases — and for files whose tags don't match the real artist or song name, which you can fix from the track's Edit metadata option.",
  },
  [LYRICS_FAILURE.NETWORK]: {
    title: "Couldn't reach the lyrics services",
    sub: "The requests didn't complete — the services may be down, or the connection dropped. This isn't a sign the song has no lyrics; it's worth trying again.",
  },
  [LYRICS_FAILURE.RATE_LIMITED]: {
    title: "Lyrics service is rate-limiting us",
    sub: "LRCLIB is temporarily refusing further lookups. Wait a minute or so and try again — the song may well be in there.",
  },
  [LYRICS_FAILURE.OFFLINE]: {
    title: "You're offline and this track isn't cached yet",
    sub: "uPod looks lyrics up in the background for everything in your library and saves them, so this is unusual — it normally only happens for a track added since the last time you had a connection.",
  },
};

// A section header in plain lyrics: "[Chorus]", "[Verse 2]".
const SECTION_RE = /^\[.*\]$/;

// How long a gap between two synced lines before they read as separate
// sections rather than one block of singing. Roughly the length of an
// instrumental break between a verse and a chorus.
const SECTION_GAP_S = 5;

// How far ahead of the stamp to light a line up. Synced lyrics are
// timed to where the vocal lands, and a karaoke line that arrives exactly
// on the beat is already too late to read — this is the standard small
// lead-in.
const LEAD_IN_S = 0.3;

// After the user scrolls by hand, auto-scroll stands down for this long
// so it isn't fighting them for control of the list.
const MANUAL_SCROLL_GRACE_MS = 4000;

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

// Turns whatever the lookup returned into one shape the renderer can
// highlight against: a flat list of lines, each tagged with the section
// it belongs to and (when the lyrics are time-synced) the moment it's
// sung. Sections are what the highlight follows — a single lit line with
// everything around it dark reads as a teleprompter, whereas lifting the
// whole verse and then the active line within it is what makes it
// possible to actually follow along.
function buildLyricModel(result) {
  if (!result?.ok || !result.lyrics) return { lines: [], sections: 0, synced: false };

  const synced = parseSyncedLyrics(result.synced);
  if (synced.length > 2) {
    let section = 0;
    let previous = null;
    const lines = synced.map((entry, i) => {
      const isHeader = SECTION_RE.test(entry.text.trim());
      // A blank stamped line, a long instrumental gap, or an explicit
      // header all mean "new section starts here".
      if (i > 0 && (isHeader || !entry.text.trim() || (previous != null && entry.time - previous > SECTION_GAP_S))) {
        section++;
      }
      previous = entry.time;
      return { text: entry.text, time: entry.time, section, isHeader };
    });
    return { lines, sections: section + 1, synced: true };
  }

  // Plain lyrics: no per-line timing exists, so the unit of highlighting
  // is the section alone. Blank lines are the stanza breaks every lyrics
  // database uses, and an explicit [Chorus] header starts one too.
  let section = 0;
  let sawContent = false;
  const lines = [];
  for (const raw of result.lyrics.split("\n")) {
    const text = raw.trim();
    const isHeader = SECTION_RE.test(text);
    if (!text) {
      if (sawContent) section++;
      sawContent = false;
      lines.push({ text: "", time: null, section, isHeader: false, blank: true });
      continue;
    }
    if (isHeader && sawContent) {
      section++;
      sawContent = false;
    }
    sawContent = true;
    lines.push({ text, time: null, section, isHeader });
  }
  return { lines, sections: section + 1, synced: false };
}

// Which line and section are current. Synced lyrics answer this exactly.
// Plain lyrics can only be estimated, and the estimate is deliberately
// coarse: sections are weighted by how many lines they hold and laid over
// the track's duration, which is right often enough to be useful for
// following along and never pretends to be word-accurate — the screen
// says as much.
function resolvePosition(model, currentTime, duration) {
  if (model.lines.length === 0) return { line: -1, section: -1, estimated: false };

  if (model.synced) {
    let line = -1;
    for (let i = 0; i < model.lines.length; i++) {
      if (model.lines[i].time <= currentTime + LEAD_IN_S) line = i;
      else break;
    }
    return { line, section: line >= 0 ? model.lines[line].section : -1, estimated: false };
  }

  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return { line: -1, section: -1, estimated: true };
  }

  const weights = new Array(model.sections).fill(0);
  for (const l of model.lines) {
    if (!l.blank && !l.isHeader) weights[l.section] += Math.max(1, Math.ceil(l.text.length / 48));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return { line: -1, section: -1, estimated: true };

  const progress = Math.min(1, Math.max(0, currentTime / duration)) * total;
  let running = 0;
  for (let s = 0; s < weights.length; s++) {
    running += weights[s];
    if (progress <= running || s === weights.length - 1) return { line: -1, section: s, estimated: true };
  }
  return { line: -1, section: -1, estimated: true };
}

export default function Karaoke() {
  const { queue, queueIndex } = usePlayerState();
  const { currentTime, duration } = usePlayerTime();
  const { seek } = usePlayerActions();
  const track = queue[queueIndex];
  const online = useOnlineStatus();

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [tryingAi, setTryingAi] = useState(false);
  const [keyDraft, setKeyDraft] = useState(getGeminiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);

  const scrollerRef = useRef(null);
  const activeRef = useRef(null);
  const manualScrollAtRef = useRef(0);

  // Runs even when offline: the lookup checks the user's own paste and the
  // IndexedDB cache of previously-sourced lyrics before it ever touches
  // the network, so a cached track still shows its lyrics with no
  // connection — which is the whole point of caching them. Only if both
  // miss does it report OFFLINE.
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setResult(null);
    setShowManual(false);
    setLoading(true);
    fetchLyricsOnline(track).then((r) => {
      if (cancelled) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, online]);

  const model = useMemo(() => buildLyricModel(result), [result]);
  const position = useMemo(
    () => resolvePosition(model, currentTime, duration),
    [model, currentTime, duration]
  );
  // The line auto-scroll centres on: the sung line when the lyrics are
  // synced, the first real line of the live section when they're only
  // estimated.
  const anchorIndex = useMemo(() => {
    if (model.synced) return position.line;
    if (position.section < 0) return -1;
    return model.lines.findIndex((l) => l.section === position.section && !l.blank);
  }, [model, position.line, position.section]);

  // Keep the current line (or section) in view, unless the user has just
  // taken over scrolling themselves.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active) return;
    if (Date.now() - manualScrollAtRef.current < MANUAL_SCROLL_GRACE_MS) return;
    const target = active.offsetTop - scroller.clientHeight / 2 + active.offsetHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [position.line, position.section]);

  function retry() {
    if (!track) return;
    setLoading(true);
    fetchLyricsOnline(track).then((r) => {
      setResult(r);
      setLoading(false);
    });
  }

  async function tryAi() {
    if (!track) return;
    setTryingAi(true);
    const r = await fetchLyricsFromGemini(track);
    setResult(r);
    setTryingAi(false);
  }

  function saveKey() {
    setGeminiKey(keyDraft.trim());
    setShowKeyInput(false);
  }

  async function saveManual() {
    if (!track || !manualDraft.trim()) return;
    saveManualLyrics(track, manualDraft).then((entry) => {
      setResult(entry);
      setShowManual(false);
    });
  }

  if (!track) {
    return <div className="karaoke-screen"><div className="empty-state">Nothing playing yet.</div></div>;
  }

  return (
    <div className="karaoke-screen">
      <div className="karaoke-header">
        <div className="karaoke-track-title">{track.title}</div>
        <div className="karaoke-track-sub">{track.artist} · {track.album}</div>
      </div>

      {loading && <div className="karaoke-loading">Searching lyrics sources…</div>}

      {!loading && result?.ok && (
        <>
          <div className="karaoke-source">
            {result.source === "manual"
              ? "Your saved lyrics"
              : result.fromCache
                ? `Saved offline · originally from ${result.source}`
                : `Found via ${result.source}`}
            {result.matchedAs ? ` · matched as ${result.matchedAs}` : ""}
            {model.synced
              ? " · time-synced"
              : model.sections > 1
                ? " · section follows playback (estimated)"
                : ""}
            {result.source === "manual" || result.ai ? "" : " · unverified, community-sourced"}
          </div>
          <div
            className={`karaoke-lyrics ${model.synced ? "is-synced" : "is-estimated"}`}
            ref={scrollerRef}
            onScroll={() => {
              manualScrollAtRef.current = Date.now();
            }}
          >
            {model.lines.map((line, i) => {
              const inSection = line.section === position.section;
              const isActive = model.synced ? i === position.line : false;
              const isAnchor = i === anchorIndex;
              const classes = [
                line.isHeader ? "karaoke-section" : "karaoke-line",
                line.blank ? "karaoke-blank" : "",
                inSection ? "in-section" : "",
                isActive ? "is-active" : "",
                !inSection && position.section >= 0 && line.section < position.section ? "is-past" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={i}
                  ref={isAnchor ? activeRef : null}
                  className={classes}
                  // Synced lyrics make every line a seek target, which is
                  // the one thing a karaoke screen can offer that a
                  // lyrics sheet can't: tap the line you want to sing.
                  onClick={model.synced && line.time != null ? () => seek(Math.max(0, line.time - LEAD_IN_S)) : undefined}
                >
                  {line.text || " "}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && !result?.ok && !showManual && (
        <div className="karaoke-offline">
          {result?.failure === LYRICS_FAILURE.OFFLINE && <WifiOff size={22} />}
          <div className="karaoke-offline-title">{FAILURE_COPY[result?.failure]?.title || "No lyrics found"}</div>
          <div className="karaoke-offline-sub">
            {FAILURE_COPY[result?.failure]?.sub || "Nothing matched this track on the free lyrics databases."}
          </div>
          <div className="np-actions" style={{ marginTop: 14 }}>
            {/* A no-match won't change on a retry — the song simply isn't in
                the databases, and the cascade has already tried every
                reading of the tags — so the retry button is only offered
                for the failures that genuinely might resolve. */}
            {result?.failure !== LYRICS_FAILURE.NOT_FOUND && (
              <button className="pill-btn" onClick={retry}><RefreshCw size={13} /> Try again</button>
            )}
            <button className="pill-btn" onClick={() => setShowManual(true)}><Save size={13} /> Paste lyrics</button>
            <button className="pill-btn" onClick={() => (getGeminiKey() ? tryAi() : setShowKeyInput(true))}>
              <Sparkles size={13} /> {tryingAi ? "Asking AI…" : "Try AI reconstruction"}
            </button>
          </div>
        </div>
      )}

      {showManual && (
        <div style={{ marginTop: 16 }}>
          <textarea
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            placeholder="Paste the lyrics here — they'll be cached for next time…"
            rows={10}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}
          />
          <button className="primary-btn" style={{ marginTop: 10 }} onClick={saveManual}>
            <Save size={14} /> Save lyrics
          </button>
        </div>
      )}

      {showKeyInput && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)" }}>
          <div className="settings-row-label" style={{ marginBottom: 6 }}><Key size={13} /> Your Gemini API key</div>
          <div className="settings-row-sub" style={{ marginBottom: 10 }}>
            Stored only in this browser, sent only to Google's API when you tap "Try AI reconstruction". Get a free key at aistudio.google.com.
          </div>
          <input
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="AIza…"
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", marginBottom: 10 }}
          />
          <button className="primary-btn" onClick={saveKey}>Save key</button>
        </div>
      )}

      {result?.ai && (
        <div className="karaoke-fallback-note">
          These lyrics were reconstructed by an AI model, not sourced from a lyrics database — treat them as approximate.
          uPod keeps looking for a real match in the background and will replace them if one turns up.
        </div>
      )}
    </div>
  );
}
