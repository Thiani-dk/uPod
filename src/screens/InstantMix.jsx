// src/screens/InstantMix.jsx
// Instant Mix, asked for rather than configured.
//
// The screen used to be two long grids of checkboxes and a Generate
// button — a form, and one that got longer the more music you owned.
// The job it does is tiny ("what should this be about, and how long?")
// so it is a short conversation now: it asks, you tap an answer, your
// answer appears as yours, and it tells you what it built and why.
//
// Nothing here is a chatbot. There is no free text, no model, no
// guessing at intent — every reply is a chip, so the thing can't
// misunderstand you and you can't be left wondering what to type. The
// conversation is a shape for the same three questions the form asked,
// and the honesty of it is that it reports its own recipe afterwards
// (see buildMix) instead of presenting a shuffle as magic.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Sparkles, Shuffle, ListPlus, RotateCcw, Dices } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { buildMix } from "../utils/instantMix";

// Long enough to read as a considered answer rather than a lookup,
// short enough that nobody taps twice thinking it missed them.
const THINKING_MS = 420;

const SIZES = [
  { label: "Short — 12 tracks", size: 12 },
  { label: "A proper sitting — 25", size: 25 },
  { label: "All evening — 50", size: 50 },
];

function Bubble({ from, children }) {
  return <div className={`mix-bubble mix-bubble-${from}`}>{children}</div>;
}

export default function InstantMix({ onBack }) {
  const { generalLibrary, albums, playlists } = usePlayerState();
  const { playTrackList, saveQueueAsPlaylist } = usePlayerActions();

  // The transcript so far: everything said by either side, in order.
  const [turns, setTurns] = useState([
    { from: "bot", text: "Let's build you a mix. What should it be about?" },
  ]);
  const [step, setStep] = useState("intent");
  const [kind, setKind] = useState(null);
  const [picks, setPicks] = useState([]);
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState(null);
  // Remembered rather than inferred from the result's length: a
  // selection too small to fill the request produces a shorter mix,
  // and "build another" would then quietly change the length asked
  // for.
  const [lastSize, setLastSize] = useState(null);
  const endRef = useRef(null);

  const artists = useMemo(() => {
    const set = new Set(generalLibrary.map((t) => t.artist));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [generalLibrary]);

  // Keeps the newest turn in view as the conversation grows, the same
  // way any transcript does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, step, thinking]);

  function say(from, text) {
    setTurns((prev) => [...prev, { from, text }]);
  }

  // Resolves a pick to real tracks at the moment it's needed, rather
  // than storing tracks — the library can change underneath this.
  function tracksFor(pick) {
    if (pick.kind === "artist") return generalLibrary.filter((t) => t.artist === pick.id);
    if (pick.kind === "album") return albums.find((a) => a.id === pick.id)?.tracks || [];
    const playlist = playlists.find((p) => p.id === pick.id);
    if (!playlist) return [];
    const byId = new Map(generalLibrary.map((t) => [t.id, t]));
    return playlist.trackIds.map((id) => byId.get(id)).filter(Boolean);
  }

  const pool = useMemo(() => {
    const merged = picks.flatMap(tracksFor);
    return [...new Map(merged.map((t) => [t.id, t])).values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, generalLibrary, albums, playlists]);

  function chooseKind(nextKind) {
    if (nextKind === "surprise") {
      // "Surprise me" still has to pick something real, or the mix has
      // nothing to be about — it just saves the user the choosing.
      const options = [
        ...artists.map((name) => ({ kind: "artist", id: name, label: name })),
        ...albums.map((a) => ({ kind: "album", id: a.id, label: a.title })),
      ];
      if (options.length === 0) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      say("you", "Surprise me");
      addPick(pick, `${pick.label} it is.`);
      return;
    }
    const labels = { artist: "An artist", album: "An album", playlist: "A playlist" };
    say("you", labels[nextKind]);
    setKind(nextKind);
    setQuery("");
    setStep("pick");
    say("bot", `Which ${nextKind}?`);
  }

  function addPick(pick, acknowledgement) {
    const next = [...picks, pick];
    setPicks(next);
    setQuery("");
    setStep("more");
    say("bot", acknowledgement || `${pick.label}. Anything else in the blend?`);
  }

  function choosePick(pick) {
    say("you", pick.label);
    addPick(pick);
  }

  function chooseMore() {
    say("you", "Add another");
    setStep("intent");
    say("bot", "What else?");
  }

  function chooseEnough() {
    say("you", "That's enough");
    setStep("size");
    say("bot", "How long do you want it?");
  }

  function chooseSize(option) {
    say("you", option.label);
    setLastSize(option);
    setStep("building");
    setThinking(true);

    // The pause is for the person, not the computer: building is
    // instant, and an answer that appears before you've finished
    // tapping doesn't read as an answer to what you asked.
    setTimeout(() => {
      const mix = buildMix({ pool, library: generalLibrary, size: option.size });
      setThinking(false);
      setResult(mix);
      setStep("done");
    }, THINKING_MS);
  }

  function restart() {
    setTurns([{ from: "bot", text: "Fresh start. What should this one be about?" }]);
    setStep("intent");
    setKind(null);
    setPicks([]);
    setQuery("");
    setResult(null);
    setLastSize(null);
  }

  const q = query.trim().toLowerCase();
  const pickOptions = useMemo(() => {
    const chosen = new Set(picks.map((p) => `${p.kind}:${p.id}`));
    let options = [];
    if (kind === "artist") options = artists.map((name) => ({ kind: "artist", id: name, label: name }));
    else if (kind === "album")
      options = albums.map((a) => ({ kind: "album", id: a.id, label: a.title, sub: a.artist }));
    else if (kind === "playlist")
      options = playlists.map((p) => ({ kind: "playlist", id: p.id, label: p.name, sub: `${p.trackIds.length} tracks` }));
    return options
      .filter((o) => !chosen.has(`${o.kind}:${o.id}`))
      .filter((o) => !q || o.label.toLowerCase().includes(q));
  }, [kind, artists, albums, playlists, picks, q]);

  function play() {
    if (!result?.tracks.length) return;
    // Already ordered by buildMix — favourites first, wildcard planted
    // later — so shuffling again here would throw the shape away.
    playTrackList(result.tracks, { shuffle: false });
  }

  function playAndSave() {
    play();
    saveQueueAsPlaylist(`Instant Mix · ${picks.map((p) => p.label).join(", ")}`.slice(0, 60));
  }

  if (generalLibrary.length === 0) {
    return (
      <div className="instant-mix-screen">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={16} /> Play Now
        </button>
        <div className="empty-state" style={{ padding: "40px 0" }}>
          Load your music folder and I'll have something to mix.
        </div>
      </div>
    );
  }

  return (
    <div className="instant-mix-screen mix-chat-screen">
      <button className="back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Play Now
      </button>

      <div className="mix-chat">
        {turns.map((turn, i) => (
          <Bubble key={i} from={turn.from}>
            {turn.text}
          </Bubble>
        ))}

        {thinking && (
          <div className="mix-bubble mix-bubble-bot mix-typing" aria-label="Working on it">
            <span /><span /><span />
          </div>
        )}

        {step === "done" && result && (
          <Bubble from="bot">
            <div className="mix-recipe-title">
              {result.tracks.length} tracks, put together like this:
            </div>
            <ul className="mix-recipe">
              <li>
                <b>{result.breakdown.favourites}</b> you play the most
              </li>
              <li>
                <b>{result.breakdown.deepCuts}</b> you've barely or never played
              </li>
              <li>
                <b>{result.breakdown.random}</b> picked at random
              </li>
              <li>
                <b>{result.breakdown.wildcards}</b> wildcard
                {result.breakdown.wildcards === 1 ? "" : "s"} from anywhere in your library
              </li>
            </ul>
          </Bubble>
        )}

        <div ref={endRef} />
      </div>

      {/* The reply row. Always the current question's answers and
          nothing else — what makes this a conversation rather than a
          form is that only one thing is ever being asked. */}
      <div className="mix-replies">
        {step === "intent" && (
          <>
            <button className="chip chip-reply" onClick={() => chooseKind("artist")}>An artist</button>
            <button className="chip chip-reply" onClick={() => chooseKind("album")}>An album</button>
            {playlists.length > 0 && (
              <button className="chip chip-reply" onClick={() => chooseKind("playlist")}>A playlist</button>
            )}
            <button className="chip chip-reply" onClick={() => chooseKind("surprise")}>
              <Dices size={12} /> Surprise me
            </button>
          </>
        )}

        {step === "pick" && (
          <>
            <div className="mix-filter">
              <input
                autoFocus
                placeholder={`Find a ${kind}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="mix-options">
              {pickOptions.slice(0, 60).map((option) => (
                <button
                  key={`${option.kind}:${option.id}`}
                  className="chip chip-reply"
                  onClick={() => choosePick(option)}
                >
                  {option.label}
                  {option.sub ? <span className="chip-sub">{option.sub}</span> : null}
                </button>
              ))}
              {pickOptions.length === 0 && (
                <div className="settings-row-sub">Nothing matching that.</div>
              )}
            </div>
          </>
        )}

        {step === "more" && (
          <>
            <button className="chip chip-reply" onClick={chooseMore}>Add another</button>
            <button className="chip chip-reply chip-active" onClick={chooseEnough}>
              That's enough — {pool.length} tracks
            </button>
          </>
        )}

        {step === "size" && (
          <>
            {SIZES.filter((option) => option.size <= Math.max(12, pool.length + 3)).map((option) => (
              <button key={option.size} className="chip chip-reply" onClick={() => chooseSize(option)}>
                {option.label}
              </button>
            ))}
          </>
        )}

        {step === "done" && result && (
          <>
            <button className="primary-btn" onClick={play}>
              <Sparkles size={14} /> Play it
            </button>
            <button className="pill-btn" onClick={playAndSave}>
              <ListPlus size={13} /> Play and save
            </button>
            <button className="pill-btn" onClick={() => chooseSize(lastSize || SIZES[1])}>
              <Shuffle size={13} /> Build another
            </button>
            <button className="pill-btn" onClick={restart}>
              <RotateCcw size={13} /> Start over
            </button>
          </>
        )}
      </div>
    </div>
  );
}
