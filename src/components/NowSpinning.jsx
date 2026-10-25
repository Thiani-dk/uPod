// src/components/NowSpinning.jsx
// The thing that turns at the top of Play Now. It is three jobs in one
// small object, because they are all the same gesture — "bring this
// up to date, and show me it's alive":
//
//   one tap    recompute the listening stats above it
//   two taps   walk the music folder for anything new
//   three taps change what is spinning
//
// Why taps rather than three buttons: the stats refresh is instant and
// idempotent, so a mistaken single tap costs nothing, and the other two
// are deliberate acts you have to mean. A row of three controls here
// would be louder than the screen it sits on.
//
// Every skin is drawn in CSS — no images, so each one picks up the
// playing track's extracted colour (--accent, set per cover by
// PlayerContext) and the current theme for free, rather than needing an
// asset per combination.
import React, { useEffect, useRef, useState } from "react";

// Within this of the last tap, the next one is part of the same
// gesture. 300ms is the usual double-tap window; a little over it
// leaves room for a deliberate third tap without the first action
// feeling laggy.
const TAP_WINDOW_MS = 320;

export const SKINS = ["record", "cassette", "cd", "boombox"];
const SKIN_LABELS = {
  record: "Record",
  cassette: "Cassette",
  cd: "CD",
  boombox: "Boombox",
};
const SKIN_KEY = "upod-now-spinning-skin";

function loadSkin() {
  try {
    const saved = localStorage.getItem(SKIN_KEY);
    return SKINS.includes(saved) ? saved : "record";
  } catch {
    return "record";
  }
}

// A classic compact cassette: two reels behind a window, the tape pack
// on each hub, and a label across the top. The reels are what turn.
function Cassette() {
  return (
    <span className="skin-cassette">
      <span className="cassette-label" />
      <span className="cassette-window">
        <span className="cassette-reel">
          <span className="cassette-hub" />
        </span>
        <span className="cassette-tape" />
        <span className="cassette-reel">
          <span className="cassette-hub" />
        </span>
      </span>
      <span className="cassette-feet" />
    </span>
  );
}

// The shine is the whole point of a CD, and it is a real optical
// effect: the data spiral is a diffraction grating, so the colour you
// see depends on the angle. A conic rainbow under a rotating specular
// sweep is the honest way to say that in CSS.
function Disc() {
  return (
    <span className="skin-cd">
      <span className="cd-rainbow" />
      <span className="cd-sheen" />
      <span className="cd-ring" />
      <span className="cd-hole" />
    </span>
  );
}

function Boombox() {
  return (
    <span className="skin-boombox">
      <span className="boombox-handle" />
      <span className="boombox-body">
        <span className="boombox-speaker">
          <span className="boombox-cone" />
        </span>
        <span className="boombox-deck">
          <span className="boombox-deck-window" />
          <span className="boombox-buttons" />
        </span>
        <span className="boombox-speaker">
          <span className="boombox-cone" />
        </span>
      </span>
    </span>
  );
}

// A 12" vinyl LP — wax. Three layers, because that is what makes it
// read as a real record rather than a dark circle: the wax itself
// turns, carrying its grooves and its paper label, while the gloss on
// top stays put. Light doesn't rotate with the record, and keeping it
// fixed is what produces the sweep of shine across the grooves as the
// disc goes round.
function Record() {
  return (
    <span className="skin-record">
      <span className="record-wax">
        <span className="record-label" />
      </span>
      <span className="record-gloss" />
    </span>
  );
}

const SKIN_VIEWS = {
  record: Record,
  cassette: Cassette,
  cd: Disc,
  boombox: Boombox,
};

export default function NowSpinning({ playing, busy, status, onRefreshStats, onScanFolder }) {
  const [skin, setSkin] = useState(loadSkin);
  // What the last gesture did, shown briefly so a double or triple tap
  // confirms itself — without it, "it scanned" and "nothing happened"
  // look identical when the folder has nothing new.
  const [flash, setFlash] = useState(null);

  const tapsRef = useRef(0);
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      clearTimeout(flashTimerRef.current);
    },
    []
  );

  function say(message) {
    setFlash(message);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 1800);
  }

  function cycleSkin() {
    setSkin((current) => {
      const next = SKINS[(SKINS.indexOf(current) + 1) % SKINS.length];
      try {
        localStorage.setItem(SKIN_KEY, next);
      } catch {
        /* a cosmetic preference isn't worth failing the tap over */
      }
      say(SKIN_LABELS[next]);
      return next;
    });
  }

  // Counts taps inside one window and acts once it closes, rather than
  // firing on every tap — otherwise a double tap would also run the
  // single-tap action, and a triple would run all three.
  function handleTap() {
    tapsRef.current += 1;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const taps = tapsRef.current;
      tapsRef.current = 0;
      if (taps === 1) {
        onRefreshStats();
        say("Stats refreshed");
      } else if (taps === 2) {
        onScanFolder();
      } else {
        cycleSkin();
      }
    }, TAP_WINDOW_MS);
  }

  const Skin = SKIN_VIEWS[skin] || Record;

  return (
    <div className="now-spinning-wrap">
      <button
        className={`now-spinning skin-is-${skin} ${playing ? "is-playing" : ""} ${busy ? "is-busy" : ""}`}
        onClick={handleTap}
        aria-label={`${SKIN_LABELS[skin]}. Tap to refresh your stats, double tap to check your folder for new music, triple tap to change what is spinning.`}
        title="Tap: refresh stats · Double tap: check for new music · Triple tap: change the player"
      >
        <Skin />
      </button>
      <div className="now-spinning-status">{busy ? status : flash || status}</div>
    </div>
  );
}
