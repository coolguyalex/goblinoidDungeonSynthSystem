# GDMS Sonics — Generative Ambient Music for Tabletop RPGs

A concept doc for a generative, mood-based ambient music system built for tabletop RPG sessions. Grows out of the GDMS (Goblinoid Dungeon Mastery System) project family. Three planned platforms, one shared musical/data philosophy.

Status: **Jukebox mode (v2) is built and live.** Advanced mode and Bank/Recycler mode are still concept-only — see "Interaction Tiers" below.

**Play it:** https://coolguyalex.github.io/GoblinoidDungeonSynthSystem/ — pick a mood (1-8), hit play. Single-key hotkeys throughout (no Ctrl-combos); press `H` for the full list. Source: `index.html` + `/js` (Web Audio, zero dependencies) + `/moods` and `/structure` (the actual musical data, plain CSV, edit with a text editor).

### v2 revision (playtester pass)

Direct feedback from the first real playtest reshaped several things:

- **Pseudo-DJ transport.** Tracks now play the section-sequence once and stop by default (was: loop forever). Loop is an explicit off-by-default toggle, plus Fade In, Fade Out (now), and Fade Out At Cycle End (graceful stop while looping) — `L` / `I` / `F` / `E` on the playing screen.
- **Reseed + save takes.** `R` rerolls a fresh generated take of the current mood without leaving it; `K` pins the exact take (mood + RNG seed) to a "saved takes" screen (`V`) so a specific take that nailed a moment can be replayed later.
- **Bass / Chords / Melody.** The generator now has a real three-voice texture — the `chords` voice can hold true stacked-note chords (`degrees` supports `a+b` chord tokens, e.g. `0+4`), not just a second melodic line. Kept deliberately conservative (mostly dyads, not full triads) to stay intelligible on small speakers and, eventually, a piezo buzzer.
- **Per-mood rework**, based on direct feedback: Dungeon/Graveyard sped up and de-mudded (was reading as a funeral dirge, not tomb-tense anxiety); Wilderness lost its percussive pulse voice in favor of long sustained tones plus a Web Audio vibrato LFO; Combat (Boss) gained a sudden mid-track "break" section — the drive drops out for a high operatic melodic contrast before slamming back in; Triumph/Opening widened its range and swapped square-wave for triangle/sawtooth for an epic rather than "tinker-toy" feel; Town was rebuilt around an actual hurdy-gurdy model (a true drone dyad, a buzzing "trompette" chord voice, an original jig-style tune). Combat (Routine) was left untouched — it was already working. Full reasoning lives in the `v2 revision note` comment at the top of each mood's CSV.

---

## The Core Idea

Real melodies aren't random notes picked from a scale — they're built from interval hierarchies, motif repetition, contour (rise/fall shape), and forced cadences. Naive generative music ("random note in key, every step") reliably produces aimless noise rather than something that feels composed.

This project encodes the *actual structural rules* that make a melody read as "heroic," "haunting," "urgent," etc. — as data, not hardcoded logic — so the system stays true to the GDMS philosophy of swappable, human-readable CSV content driving everything.

## Why This Belongs in the GDMS Family

- Same content philosophy: mood definitions, interval weights, motif seeds, and structure all live in plain CSV/data files a user can read and edit with a text editor — no rebuild required.
- Same target use case: sits at the table alongside GDMS:Pocket, serving DM/session needs (in this case, ambient mood music) rather than being a general-purpose music tool.
- Natural content-marketing tie-in: a free browser-based version is a low-friction way to get people curious about the hardware side of the GDMS product line.

## Musical Design Principles (the actual "DNA")

These are the rules the generator should encode per mood, not leave to chance:

1. **Weighted scale degrees, not uniform random.** Tonic, 3rd, and 5th should dominate, especially on strong beats. Passing tones are connective, not equal-probability events.
2. **Leap-then-step resolution.** A melodic leap should usually resolve with stepwise motion in the opposite direction — this alone fixes most of the "sounds amateurish" problem.
3. **Contour as an envelope.** Each phrase should follow a low-resolution shape (rising-then-falling for heroic, narrow-hovering for haunting) that individual note choices are pulled toward — not just note-by-note independence.
4. **Motif + variation, not fresh randomness per bar.** Short seed motifs (3–5 notes) get transposed/lightly varied and restated, rather than regenerated from scratch each cycle.
5. **Forced cadences.** Phrase endings should be strongly biased toward tonic (resolved/triumphant) or deliberately away from it (unresolved/haunting) — this rarely happens by chance often enough on its own.
6. **Structure over time.** A mood needs a section-sequence (intro → A → A-variation → B → fade), not one loop played indefinitely. Structure data is separate from mood/interval data.

## Mood Set (v1)

| Mood | Character | Notes |
|---|---|---|
| Dungeon / Graveyard | Anxious, alert — not grieving | Narrow range, locrian minor 2nds/tritones, brisk and clipped, chord-voice dissonant "stabs" |
| Wilderness | Open, spacious | Long sustained bass/chord tones (no percussion voice), open 4ths/5ths, lead vibrato |
| Combat (routine) | Driving, repetitive | Short motif, rhythmic urgency over harmonic complexity — the reference pattern, untouched in v2 |
| Combat (boss) | Driving, then operatic | Constant drive breaks suddenly into a high, resolved melodic contrast section, then resumes |
| Triumph / Opening | Epic, resolved, not driving | Wide sweeping contour and register, no percussion voice — grand rather than bouncy |
| Town | Literal hurdy-gurdy | True drone dyad (tonic+5th) in bass, buzzing "trompette" chord stabs, original jig-style tune |
| Tavern | Irish traditional | Dotted rhythms, modal (Dorian), distinct from strict major/minor moods |
| Camp / Downtime | Sparse, slow | Long note durations, wide silences, minimal motif — the "anti-combat" mood |

Several of these share an underlying generator template with different parameters (e.g., dungeon and wilderness are both "tense" but differ in leap-width and register) — not eight separate systems.

## Interaction Tiers

**1. Jukebox mode (default/shipped experience)**
All curation decisions are pre-made. The system ships preloaded with hand-picked motifs (selected by running the generator ahead of time) and a fixed recycle-rate (e.g., ~35% chance of pulling from the curated bank vs. generating fresh). User just picks a mood and hits play. No live decision-making required — appropriate for a DM who has zero spare attention mid-session.

**2. Advanced mode**
Each generator layer (interval weights, motif length, rhythm template, cadence rule) is independently swappable via its own CSV, so a user can mix e.g. "tense dungeon" intervals with "boss combat" rhythm without new code.

**3. Bank/recycler mode ("generative recursion")**
Turing-Machine-inspired live curation. Motifs play; the user can flag ("lock") one that just played, saving it to a per-mood, per-voice bank with an incrementing weight. A dial per voice controls the blend between "always generate fresh" (0) and "heavily favor banked/flagged motifs" (100). Each of the (typically 4) voices gets its own independent dial — e.g., lock the drone voice near 100 once it's good, leave the lead voice low to keep it evolving. This tier is for prep sessions or curious players, not live DM use.

## Platform Plan

### 1. Web app (OG GDMS spin-off)
- Port of the original desktop GDMS (Tkinter/Python) to static HTML/CSS/JS — zero third-party dependencies, hosted free on GitHub Pages.
- Web Audio API (`OscillatorNode` + `GainNode`) natively provides square/triangle/sawtooth waveforms and amplitude envelopes — a native-browser equivalent of the buzzer-voice constraint, no libraries needed.
- Navigation ported from the original `Ctrl+key` scheme to single-key hotkeys (Nethack/Dwarf Fortress-inspired — no browser key-reservation conflicts).
- `localStorage` for notes/saved state/motif banks — no backend, no server, no account system.
- CSV files loaded via `fetch()` at runtime, same swap-and-edit philosophy as the original.
- Doubles as low-friction marketing funnel toward the hardware line.
- **Known original-code bug to fix in the port:** several screens (notes, log entry, reminders) bind hotkeys directly to the window without going through the central context-aware dispatcher, and don't unbind on screen change — causing hotkeys to misfire on the wrong screen. Fix: single centralized keydown listener gated entirely by current screen state.

### 2. Dedicated hardware sibling device
- Standalone product, separate from GDMS:Pocket (whose 128×128 screen and single-buzzer setup can't reasonably support this).
- Target: **4 voices**, Game Boy-sound-chip-inspired (4-channel tracker architecture — genre-authentic symmetry with chiptune roots).
- Realistic PWM channel ceiling: RP2040 gives ~6–8 independent channels before fighting the chip's own architecture; ESP32's LEDC peripheral supports up to 16. Either has headroom for 4 voices.
- Real ceiling is acoustic, not electrical — passive buzzers in a shared small enclosure get muddy past ~4–6 voices (phase interference, physical rattling), so 4 is a deliberate sweet spot, not a limitation.
- Should ship in **Jukebox mode only** — this is a listening device, not a live-performance instrument.

### 3. Playdate app
- Strong platform fit: native `playdate.sound.synth` API exposes square/saw/sine/custom waveforms plus real ADSR envelope control — does properly in software what the buzzer hardware has to fake via PWM duty-cycling.
- Prior art exists in this space on the platform already (drone instruments, modular-synth-style tools in the Playdate itch.io scene) — this is a proven genre for the hardware, not a stretch.
- The crank is a natural, on-the-nose physical control for the recycle-rate dial in bank/recycler mode.
- **Side-quest idea, worth its own small project:** a dedicated hurdy-gurdy drone instrument/app for Playdate — the platform and the instrument's sustained-drone-plus-melody structure fit unusually well together.

## Data File Sketch (subject to change)

```
/moods/
  dungeon.csv        (interval weights, register, leap rules)
  wilderness.csv
  combat_routine.csv
  combat_boss.csv
  triumph.csv
  town.csv
  tavern.csv
  camp.csv
/structure/
  <mood>_structure.csv   (section sequence: intro/A/A-var/B/fade, per-voice activity, dial shifts)
/bank/
  <mood>_<voice>_bank.csv   (locked motifs + flag-count weight, user-generated at runtime)
```

## Open Questions / Not Yet Decided

- Exact interval-weight table values per mood (needs actual prototyping/listening, not just theory).
- Whether structure files are per-mood or share a small set of reusable templates.
- Hardware BOM/voice-count tradeoff for the dedicated device once the acoustic ceiling is tested empirically rather than estimated.
- Whether the web version's bank/recycler mode should be gated behind "advanced" or exposed by default (leaning toward gated, per the "DM has no spare RAM" principle).

---

*Concept documented — part of the GDMS project family (GDMS, GDMS:Pocket).*

