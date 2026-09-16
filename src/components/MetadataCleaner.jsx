// src/components/MetadataCleaner.jsx
// Conversational metadata cleanup for one track.
//
// Why a conversation rather than another form sheet like
// MetadataEditModal: the job isn't "edit four fields", it's "work out
// what this file actually is", and that's a back-and-forth — search,
// look at what came back, none of those are right, search differently,
// give up and just say what it is. A form can't express "I don't know
// yet", which is the state most of these files start in.
//
// This component owns the conversation only. Committing a result is the
// caller's job via onCommit, so the flow can be reasoned about (and
// changed) without touching persistence.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Search, Send, Check, Sparkles, AlertCircle } from "lucide-react";
import { lookupTrackMetadata, deriveSearchTerms, splitArtistTitle } from "../online/metadataLookup";
import { LOOKUP_FAILURE } from "../online/musicbrainz";
import useBackButtonClose from "../utils/useBackButtonClose";

// Copy per failure reason. Kept distinct on purpose, the same discipline
// lyrics.js uses: a genuine no-match is the *expected* outcome for a
// voice note and must not read like a malfunction, while a throttle or a
// misconfigured build is a real fault and should say so.
const FAILURE_COPY = {
  [LOOKUP_FAILURE.NOT_FOUND]: {
    text: "I couldn't find anything matching that. If this is a personal recording it won't be in the database at all — nothing is wrong, it just isn't something that was ever released.",
    retry: false,
  },
  [LOOKUP_FAILURE.OFFLINE]: {
    text: "You're offline, so I can't look anything up right now. You can still tell me what this is yourself.",
    retry: true,
  },
  [LOOKUP_FAILURE.NETWORK]: {
    text: "The lookup didn't get through. That's usually a flaky connection rather than anything to do with this track.",
    retry: true,
  },
  [LOOKUP_FAILURE.RATE_LIMITED]: {
    text: "The music database is asking me to slow down. Give it a few seconds and try again.",
    retry: true,
  },
  [LOOKUP_FAILURE.BLOCKED]: {
    text: "The music database turned the request away because this build isn't identifying itself properly. That's a bug in the app, not something you can fix here — but you can still tell me what this track is.",
    retry: false,
  },
};

let turnId = 0;
const nextId = () => ++turnId;

export default function MetadataCleaner({ track, onClose, onCommit }) {
  useBackButtonClose(onClose);
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  // The composer serves two different intents and has to know which:
  // "declare" takes the user's word as the answer, "search" feeds it back
  // into another lookup. Same input, opposite meaning — conflating them
  // would silently record a search query as a track's real title.
  const [composerMode, setComposerMode] = useState(null);
  const [draft, setDraft] = useState("");
  const [done, setDone] = useState(false);
  const scrollRef = useRef(null);
  const startedRef = useRef(false);

  const say = useCallback((role, content, extra = {}) => {
    setTurns((prev) => [...prev, { id: nextId(), role, content, ...extra }]);
  }, []);

  // What the lookup will actually search for, shown up front so a bad
  // result is explainable ("ah, it searched the wrong thing") instead of
  // mysterious.
  const initialTerms = useMemo(() => deriveSearchTerms(track), [track]);

  const runLookup = useCallback(
    async (terms) => {
      setBusy(true);
      const probe = terms || initialTerms;
      const res = await lookupTrackMetadata(
        // lookupTrackMetadata derives its own terms from a track, so an
        // explicit re-search is expressed as a synthetic track carrying
        // the corrected strings rather than a second code path.
        terms ? { ...track, title: terms.title, artist: terms.artist || "", relativePath: "" } : track
      );
      setBusy(false);

      if (res.ok) {
        say("bot", `I found ${res.candidates.length} possible ${res.candidates.length === 1 ? "match" : "matches"}. Which one is this?`);
        say("bot", null, { kind: "candidates", candidates: res.candidates });
        return;
      }
      const copy = FAILURE_COPY[res.failure] || FAILURE_COPY[LOOKUP_FAILURE.NETWORK];
      say("bot", copy.text, { kind: "failure", canRetry: copy.retry, terms: probe });
    },
    [track, initialTerms, say]
  );

  // Opening greeting + first lookup. Guarded because React runs mount
  // effects twice in StrictMode and a duplicated greeting would be an
  // obvious tell.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const { title, artist } = initialTerms;
    say("bot", `Let's work out what this file actually is. I'll search for ${artist ? `"${title}" by ${artist}` : `"${title}"`}.`);
    runLookup(null);
  }, [initialTerms, runLookup, say]);

  // Keep the newest turn in view. Behaviour, not animation — on a phone
  // the composer takes half the sheet once the keyboard is up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, composerMode, busy]);

  function chooseCandidate(c) {
    say("user", `${c.title} — ${c.artist}${c.album ? ` (${c.album})` : ""}`);
    say("bot", "Good. I'll record that as this track's real information.", {
      kind: "confirm",
      record: {
        origin: "verified",
        fields: { title: c.title, artist: c.artist, album: c.album || "", year: c.year || null },
        source: {
          provider: "musicbrainz",
          recordingId: c.recordingId,
          releaseId: c.releaseId,
          releaseGroupId: c.releaseGroupId,
          matchedAt: Date.now(),
          score: c.score,
        },
      },
    });
  }

  function askUserToDescribe() {
    say("bot", "Tell me what this is and I'll take your word for it. \"Artist - Title\" works, or just the title on its own.");
    setComposerMode("declare");
  }

  function askForBetterSearch() {
    say("bot", "What should I search for instead? The closer to the real artist and title, the better.");
    setComposerMode("search");
  }

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    const mode = composerMode;
    say("user", text);
    setDraft("");
    setComposerMode(null);

    if (mode === "search") {
      const { artist, title } = splitArtistTitle(text);
      runLookup({ title, artist });
      return;
    }

    const { artist, title } = splitArtistTitle(text);
    say("bot", artist ? `So that's "${title}" by ${artist} — right?` : `So the title is "${title}", and you'd rather not say who it's by — right?`, {
      kind: "confirm",
      declared: true,
      record: {
        origin: "declared",
        fields: { title, artist: artist || "", album: "", year: null },
        source: null,
      },
    });
  }

  function commit(record) {
    onCommit(record);
    setDone(true);
    say(
      "bot",
      record.origin === "verified"
        ? "Done — this track is identified now and behaves like any other."
        : "Done. I've saved that as this track's information. Because nothing online confirms it, it stays out of the general Tracks list — add it to a playlist or an album and it'll show up there.",
      { kind: "finished" }
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet cleaner-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            <Sparkles size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Clean up track info
          </h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="cleaner-filename" title={track.relativePath || track.title}>
          {track.relativePath?.split("/").pop() || track.title}
        </div>

        <div className="cleaner-log" ref={scrollRef}>
          {turns.map((t) => (
            <Turn
              key={t.id}
              turn={t}
              disabled={done}
              onChoose={chooseCandidate}
              onDescribe={askUserToDescribe}
              onRetry={() => runLookup(t.terms)}
              onSearchAgain={askForBetterSearch}
              onCommit={commit}
            />
          ))}
          {busy && (
            <div className="cleaner-bubble cleaner-bot cleaner-thinking">
              <Search size={13} /> Searching the music database…
            </div>
          )}
        </div>

        {composerMode && !done && (
          <div className="cleaner-composer">
            <input
              value={draft}
              autoFocus
              placeholder={composerMode === "search" ? "Search for…  e.g. Linkin Park - Numb" : "e.g. Linkin Park - Numb"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitDraft()}
            />
            <button className="cleaner-send" onClick={submitDraft} disabled={!draft.trim()} aria-label="Send">
              <Send size={15} />
            </button>
          </div>
        )}

        {!composerMode && !done && !busy && turns.some((t) => t.kind === "candidates") && (
          <div className="cleaner-actions">
            <button className="ghost-btn" onClick={askUserToDescribe}>
              None of these
            </button>
            <button className="ghost-btn" onClick={askForBetterSearch}>
              Search different words
            </button>
          </div>
        )}

        {done && (
          <div className="cleaner-actions">
            <button className="ghost-btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Turn({ turn, disabled, onChoose, onDescribe, onSearchAgain, onRetry, onCommit }) {
  if (turn.kind === "candidates") {
    return (
      <div className="cleaner-candidates">
        {turn.candidates.map((c) => (
          <button key={c.recordingId} className="cleaner-candidate" disabled={disabled} onClick={() => onChoose(c)}>
            <div className="cleaner-candidate-main">
              <div className="cleaner-candidate-title">{c.title}</div>
              <div className="cleaner-candidate-sub">
                {c.artist}
                {c.album ? ` · ${c.album}` : ""}
                {c.year ? ` · ${c.year}` : ""}
              </div>
              {/* Almost always the only thing telling five identically
                  named candidates apart — see metadataLookup.js. */}
              {c.disambiguation && <div className="cleaner-candidate-note">{c.disambiguation}</div>}
            </div>
          </button>
        ))}
      </div>
    );
  }

  if (turn.kind === "failure") {
    return (
      <>
        <div className="cleaner-bubble cleaner-bot">
          <AlertCircle size={13} style={{ verticalAlign: "-2px", marginRight: 6, opacity: 0.7 }} />
          {turn.content}
        </div>
        {!disabled && (
          <div className="cleaner-actions cleaner-actions-inline">
            {turn.canRetry && (
              <button className="ghost-btn" onClick={onRetry}>
                Try again
              </button>
            )}
            <button className="ghost-btn" onClick={onSearchAgain}>
              Search different words
            </button>
            <button className="ghost-btn" onClick={onDescribe}>
              I'll tell you what it is
            </button>
          </div>
        )}
      </>
    );
  }

  if (turn.kind === "confirm") {
    return (
      <>
        <div className="cleaner-bubble cleaner-bot">{turn.content}</div>
        {!disabled && (
          <div className="cleaner-actions cleaner-actions-inline">
            <button className="ghost-btn cleaner-primary" onClick={() => onCommit(turn.record)}>
              <Check size={14} /> Save it
            </button>
            <button className="ghost-btn" onClick={onDescribe}>
              Not quite
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`cleaner-bubble ${turn.role === "user" ? "cleaner-user" : "cleaner-bot"}`}>{turn.content}</div>
  );
}
