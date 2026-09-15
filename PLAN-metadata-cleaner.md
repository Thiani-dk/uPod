# Plan — conversational metadata cleaner ("AutoTagger")

Scoping document. No implementation code written yet.

Everything below marked **verified** was checked live against the real APIs /
npm registry / this codebase during scoping, not assumed.

---

## 1. Lookup source feasibility

### 1a. MusicBrainz for general metadata — yes, suitable

`src/online/trackOrder.js` currently uses only `/ws/2/release/?query=…`. The
endpoint needed for per-track identification is `/ws/2/recording/?query=…`,
which is a different endpoint but the same free, keyless, CORS-enabled service.

**Verified** — live query for `recording:"By Myself" AND artist:"Linkin Park"`
returned `count: 25`, each result carrying:

- `score` (0–100 relevance — directly usable to rank candidates)
- `title`, `length`, `artist-credit[].name` + artist MBID
- `disambiguation` (e.g. *"live, 2003-08-02: Reliant Stadium, Houston"*) —
  this is exactly the text that makes a candidate list meaningful to a human
- `releases[]` with release MBIDs (the join key for cover art)

`access-control-allow-origin: *` **verified** on the MusicBrainz web service,
so this works from the WebView with no proxy — same as the existing module.

**Two real constraints, both worth deciding on up front:**

1. **Rate limit — 1 request/sec/IP.** I tripped throttling during scoping just
   by probing a handful of queries in a loop. Today the app makes an occasional
   album-level lookup; this feature makes a *per-track* lookup, so a request
   queue with serialisation + backoff is mandatory, not a nicety. It belongs in
   a shared client module both `trackOrder.js` and the new code use.
2. **User-Agent policy.** MusicBrainz requires a descriptive `User-Agent`
   identifying the app. A WebView `fetch()` **cannot set `User-Agent`** — it's a
   forbidden header. This is a *pre-existing* gap in `trackOrder.js`, not
   something this feature introduces, but going from occasional to per-track
   lookups makes it far more visible and more likely to attract a block. The
   honest options are: (a) accept the risk, (b) route through a tiny proxy that
   sets the header, or (c) set the WebView's application-wide UA string in the
   Capacitor Android config. (c) is cheapest and is worth testing first.

### 1b. Cover art — Cover Art Archive, best-effort only

CAA is the companion service, keyed by release MBID, and **verified**
CORS-enabled (`access-control-allow-origin: *`).

**But coverage is patchy** — I probed several genuine release MBIDs resolved
from MusicBrainz and got `404` on most of them. Cover art must therefore be
treated as an optional bonus of a successful match, never as a success
criterion, and the UI must not imply a match failed because art was missing.

Landing place already exists: the `coverOverrides` IndexedDB store, which is
deliberately separate from `tracks` and already survives a rescan.

### 1c. Audio fingerprinting — feasible, but it does *not* solve the case you raised

This is the finding most worth your attention, because the intuition in the
brief is inverted.

**Feasibility: genuinely good.** **Verified** on npm:

- `capacitor-chromaprint@7.0.0` — MIT, zero runtime deps, peer
  `@capacitor/core >=7.0.0` (this app is on 8.x, so satisfied). A **native**
  Capacitor plugin, which sidesteps the expensive part entirely: no WASM
  Chromaprint, no `decodeAudioData` of a whole track to PCM on the WebView main
  thread. (WASM alternatives exist — `rusty-chromaprint-wasm`,
  `@unimusic/chromaprint` — but they'd put the decode cost in the WebView.)
- AcoustID lookup API is **verified** CORS-enabled (`access-control-allow-origin: *`)
  and returns `{"error":{"code":4,"message":"invalid API key"}}` without a key —
  i.e. it needs a free registered API key, which is a registration step, not a
  cost.

**But here's the problem.** The brief motivates fingerprinting with *"a voice
note has no useful filename to search on."* Fingerprinting does not help there.
AcoustID is a lookup against a database of **known commercial recordings**. A
personal voice note is not in that database, so a perfect fingerprint returns
zero matches. Fingerprinting cannot identify audio that was never published.

What fingerprinting *actually* solves is a different and arguably bigger
problem in this library: **real, commercially-released music with junk
filenames or absent tags** — the `[MP3DL.CC] … -192k` files that
`cleanForSearch()` in `lyrics.js` already exists to paper over. For those,
filename search is unreliable and fingerprinting is decisive.

**So the two populations are genuinely different and need different paths:**

| Population | Best identification route |
|---|---|
| Released music, bad tags/filename | Fingerprint → AcoustID → MusicBrainz. High confidence. |
| Released music, decent tags | MusicBrainz text search on existing tags. Cheap, no key. |
| Voice notes / personal recordings | **Only** the user telling the bot. Inherent, not a gap. |

**Recommendation:** ship text-search first (no API key, no new dependency, no
native plugin), and treat fingerprinting as a distinct, later, opt-in pass. The
"user declares it" path is not a fallback for a missing feature — for
unpublished audio it is the *only* correct answer, and should be presented as a
first-class path rather than a consolation prize.

---

## 2. The chat UI

This is a genuinely new surface. What exists today and how it relates:

- **`MetadataEditModal` / `AddToPlaylistModal` / `QueueModal`** — all
  `.modal-overlay` + `.modal-sheet` form sheets. Reusable: the overlay/sheet
  CSS, `useBackButtonClose`. Not reusable: the interaction model.
- **Karaoke's Gemini path** — worth being precise, because the brief asks
  whether it overlaps. It is **not** conversational: `fetchLyricsFromGemini()`
  is a single-shot prompt returning one blob of text, with a key input field.
  There is no turn history and no user selection among options. So there's no
  chat machinery to reuse.

  Two things there *are* worth reusing, and they're the valuable parts:
  1. **`LYRICS_FAILURE`** — the discipline of distinguishing `NOT_FOUND` /
     `NETWORK` / `RATE_LIMITED` / `OFFLINE` so a genuine no-match doesn't read
     like a malfunction. The cleaner needs exactly this; a track with no match
     is the *expected* case here, even more than in lyrics.
  2. **The provenance discipline** — `lyrics.js` deliberately never caches AI
     output alongside sourced lyrics. That principle is the direct ancestor of
     the authority model in §3, and the feature should inherit it consciously.

**What the chat surface needs:**

- A turn list (`{ role: "bot" | "user", kind: "text" | "candidates" | "prompt" }`)
  held in component state — this is a per-session flow, and there's no
  requirement to persist transcripts. Not persisting is the right default.
- A **candidate turn** rendering N results as selectable cards (title, artist,
  album, year, `disambiguation`, MB `score`, art thumbnail if CAA has one), each
  tappable to commit.
- A free-text composer for the "let me just tell you" path, ideally with light
  parsing of `Artist - Title` plus explicit confirmation of what was understood
  before committing.
- Explicit terminal states: *matched & applied*, *declared & applied*,
  *skipped*. The flow must always end somewhere the user chose.
- Scrolling/keyboard behaviour on a phone WebView — the one genuinely fiddly
  bit, and where most of the UI time will go.

**Design constraint from memory:** this device's WebView renders
`backdrop-filter` surfaces as text-bleed holes. Every new surface here must be
fully opaque on `.native-platform`, same as the sidebar fix.

---

## 3. Metadata authority model

Proposed per-track field:

```
metadataOrigin: "embedded" | "verified" | "declared"
metadataSource: { provider, id, matchedAt, score } | null
```

- **`verified`** — matched against MusicBrainz/AcoustID and accepted by the
  user. Carries the MBID in `metadataSource`.
- **`declared`** — the user stated it. Authoritative for display, deliberately
  *not* treated as verified for pooling (§4).
- **`embedded`** — whatever the file's own tags said. The existing default.

### Interaction with `MetadataEditModal`

Recommendation: **a manual edit there sets `declared`.** It is the same act as
telling the bot, just through a form, and having two mechanisms with different
trust levels for the same user intent would be incoherent.

One consequence to accept deliberately: today a user can hand-fix a track's tags
in that modal and it stays in the general pool. Under §4, a hand-edited track
would drop *out* of the general pool. That is a real behaviour change and needs
either a migration default or a deliberate carve-out — flagging it now rather
than discovering it after the fact.

### Persistence — this is the important architectural finding

The obvious move is to add the fields to the track record in the `tracks`
store. **That would silently lose the data**, because `saveLibrary()` does
`tx.objectStore(TRACKS_STORE).clear()` on every single rescan, and only
`reviewStatus` survives — via explicit carry-forward code in
`pickNativeFolder()` that rebuilds it from `libraryRef.current`.

User-declared metadata is user data, not derived data. It must follow the
`coverOverrides` precedent instead: **its own object store**, keyed by track id,
never cleared by a rescan, re-applied onto the freshly-scanned library at
`LOAD_LIBRARY` time exactly as covers already are.

```
metadataStore: { trackId, origin, fields: {title, artist, album, year}, source, updatedAt }
```

This needs a `DB_VERSION` bump (3 → 4) and a new store in `onupgradeneeded`.

Caveat worth designing around: track ids are
`` `${relativePath}-${size}-${mtime}` `` (`metadata.js:172`), so renaming or
re-downloading a file orphans its declared metadata. Acceptable for v1; worth a
secondary lookup by `relativePath` alone if it bites.

---

## 4. Visibility scoping

`state.library` is the single pool and **everything** derives from it. Verified
consumer list:

| Site | Current use |
|---|---|
| `Library.jsx:339` | Tracks tab list — `library.map(...)` |
| `Library.jsx:61` | `visiblePool` for tab rendering |
| `utils/search.js:31,48` | Unified search — filters `library` for tracks *and* derives artists |
| `PlayNow.jsx:91` | `computeLibraryStats(library, albums, playlists)` |
| `InstantMix.jsx:14,34` | Artist/album pickers derived from `library` |
| `PlayerContext:192` | `groupIntoAlbums(library)` → `state.albums` |
| `PlayerContext:1526` | `playRandomMixFrom(pool, track)` — random-100; pool supplied by caller |

The random-100 queue is *not* a separate pool — it takes whatever `pool` the
caller passes, which today is the Tracks-tab library. So fixing the pool at
source fixes the random mix for free.

**Recommendation: filter once, in the reducer, not at seven call sites.**

There's a cautionary precedent: `possiblyNotMusic && !reviewStatus` filtering is
duplicated by hand in `Settings.jsx:28` and `ReviewTracks.jsx:25`. Repeating
that pattern across seven consumers is how the rule gets applied inconsistently.

Derive alongside `albums` in `LOAD_LIBRARY`:

- `state.library` — **complete** set. Stays the resolution target for
  playlists, albums, queue restore, and direct navigation, so a declared-only
  track reached via its assigned playlist still plays normally.
- `state.generalLibrary` — `verified` + legitimate `embedded`, excluding
  `declared`-only. The Tracks tab, search, PlayNow stats, InstantMix and the
  random-100 pool all switch to this.

`groupIntoAlbums` should keep running on the full `library` so an explicitly
assigned album still shows its tracks — with the general *Albums* tab reading
from the general pool. That split needs confirming against how you want albums
to behave; it's the one genuinely ambiguous spot in the brief.

---

## 5. Implementation breakdown

Honest scope assessment first: **this is not one feature.** It's a lookup
client, a persistence-layer change with a schema migration, a new UI paradigm,
and a cross-cutting filtering change touching seven consumers — plus an
optional native plugin. Realistically **7 passes**, of which 1–5 are the
shippable core and 6–7 are genuinely optional.

| # | Pass | Scope | Risk |
|---|---|---|---|
| 1 | **MusicBrainz recording client** — `src/online/metadataLookup.js`; shared rate-limited queue; refactor `trackOrder.js` onto it; `LOOKUP_FAILURE` reasons mirroring `LYRICS_FAILURE`. No UI. | S–M | Low |
| 2 | **Authority model + persistence** — new IndexedDB store, `DB_VERSION` 3→4, re-apply at `LOAD_LIBRARY` like `coverOverrides`, `metadataOrigin` on the track shape. No UI. | M | **Medium — schema migration** |
| 3 | **Chat surface** — new `MetadataCleaner` screen/modal, turn model, candidate cards, free-text path, terminal states. Opaque-on-native. | **L — biggest single pass** | Medium |
| 4 | **Wire cleaner → authority model** — commit verified/declared results, cover art via CAA into `coverOverrides`, `MetadataEditModal` writes `declared`. | M | Medium |
| 5 | **Visibility scoping** — `state.generalLibrary`, switch the seven consumers, decide the Albums-tab question, migration default for existing hand-edited tracks. | M | **Medium — user-visible behaviour change** |
| 6 | *(optional)* **Fingerprinting** — `capacitor-chromaprint`, AcoustID key handling (BYO-key, `lyrics.js` localStorage pattern), fingerprint→lookup path in the cleaner. | L | High — native dep, key, battery/time cost |
| 7 | *(optional)* **Bulk cleaning** — run the cleaner over every unidentified track in sequence. Only sane once 1–5 are proven. | M | Low |

**Sequencing notes**

- Pass 2 before 3. Building the chat UI against a persistence model that can't
  survive a rescan would mean rewriting the commit path.
- Pass 5 is the one to land last and test hardest — it's the only pass that
  changes what the user sees in screens they already use daily. Worth gating
  behind a setting initially.
- Pass 6 is a clean seam. Nothing in 1–5 depends on it, and the "user declares
  it" path in pass 3 is the correct terminal answer for unpublished audio
  regardless of whether 6 ever ships.

**Open questions for you**

1. Albums tab — general pool or full library? (§4)
2. Should existing hand-edited tracks be grandfathered into the general pool, or
   drop out under the new rule? (§3)
3. Fingerprinting — worth the native dep and AcoustID key, given it helps
   mistagged commercial music but does nothing for voice notes? (§1c)
