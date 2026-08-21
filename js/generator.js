// Rule-driven phrase/piece assembly. This is the "not random-note garbage" layer.
//
// Design: jukebox mode is motif-dominant (per the brief: curated bank, not pure live
// generation). Each phrase is built from a hand-authored seed motif (from CSV), which
// already embodies weighted degrees + contour + resolved leaps because it was composed
// that way. Repeats of that motif within a section get LIGHT rule-driven variation
// (one note nudged, biased by the contour envelope and corrected by the leap-resolution
// rule) rather than being regenerated from scratch, and section endings get a forced
// cadence. This directly implements README "Musical Design Principles" 1-6.

import { degreeToMidi, fitToRegister, weightedPick } from './theory.js';

function cloneMotif(m) {
  return { ...m, degrees: [...m.degrees], rhythm: [...m.rhythm] };
}

function findMotif(mood, voice, sectionName) {
  const list = mood.motifs[voice] || [];
  if (list.length === 0) return null;
  let hit = list.find((m) => m.section === sectionName);
  if (hit) return cloneMotif(hit);

  // "<base>-variation" sections reuse the base section's motif, transposed.
  const baseName = sectionName.replace(/-variation$/, '').replace(/_var$/, '');
  hit = list.find((m) => m.section === baseName);
  if (hit) {
    const varied = cloneMotif(hit);
    varied.degrees = varied.degrees.map((d) => (d === 'R' ? 'R' : d + 2));
    return varied;
  }

  return cloneMotif(list[0]);
}

function pickWeightedDegree(mood, beatIsStrong, contourTarget, rng) {
  const weights = mood.intervalWeights;
  if (!weights || weights.length === 0) return 0;
  return weightedPick(
    weights,
    (w) => {
      const base = beatIsStrong ? w.weightStrong : w.weightWeak;
      const dist = contourTarget == null ? 0 : Math.abs(w.degree - contourTarget);
      return base / (1 + dist);
    },
    rng
  ).degree;
}

function contourTargetAt(mood, idx, total) {
  const contour = mood.meta.contour;
  if (!contour || contour.length === 0) return null;
  const pos = total <= 1 ? 0 : idx / (total - 1);
  const i = Math.min(contour.length - 1, Math.floor(pos * contour.length));
  return contour[i];
}

// Rule 2: leap-then-step resolution. Walk the sequence; whenever a jump exceeds
// maxLeap, force the following note to move one step back in the opposite direction.
function resolveLeaps(degrees, maxLeap) {
  for (let i = 1; i < degrees.length; i++) {
    const prev = degrees[i - 1];
    const cur = degrees[i];
    if (prev === 'R' || cur === 'R') continue;
    const leap = cur - prev;
    if (Math.abs(leap) > maxLeap && i + 1 < degrees.length && degrees[i + 1] !== 'R') {
      const dir = leap > 0 ? -1 : 1;
      degrees[i + 1] = cur + dir;
    }
  }
  return degrees;
}

function applyCadence(degrees, rhythm, mood, cadenceType) {
  if (!cadenceType || degrees.length === 0) return;
  const lastIdx = degrees.length - 1;
  if (cadenceType === 'resolved') {
    degrees[lastIdx] = 0; // tonic
    rhythm[lastIdx] = rhythm[lastIdx] * 1.5;
  } else if (cadenceType === 'unresolved') {
    const tension = mood.meta.tension_degree !== undefined ? parseInt(mood.meta.tension_degree, 10) : 1;
    degrees[lastIdx] = tension;
    rhythm[lastIdx] = Math.max(0.5, rhythm[lastIdx] * 0.6);
  }
}

function beatsOf(rhythm) {
  return rhythm.reduce((a, b) => a + b, 0);
}

// Build one voice's phrase for one section, filling exactly `lengthBeats`.
function generatePhrase(mood, voice, sectionName, lengthBeats, cadenceType, rng) {
  const base = findMotif(mood, voice, sectionName);
  if (!base || base.degrees.length === 0) return { degrees: [], rhythm: [] };

  const degrees = [];
  const rhythm = [];
  let repeatCount = 0;

  while (beatsOf(rhythm) < lengthBeats) {
    const rep = cloneMotif(base);
    // Every repeat after the first gets one light, rule-guided variation instead of
    // being regenerated: nudge the note closest to the contour target's opposite
    // extreme, biased by the mood's weighted degrees for this voice's register.
    if (repeatCount > 0 && rep.degrees.length > 1) {
      const idx = repeatCount % rep.degrees.length;
      if (rep.degrees[idx] !== 'R') {
        const strong = idx % 2 === 0;
        const target = contourTargetAt(mood, degrees.length + idx, degrees.length + rep.degrees.length + 4);
        rep.degrees[idx] = pickWeightedDegree(mood, strong, target, rng);
      }
    }
    degrees.push(...rep.degrees);
    rhythm.push(...rep.rhythm);
    repeatCount++;
    if (repeatCount > 64) break; // safety valve against malformed (zero-length) motifs
  }

  // Truncate to fit the section length exactly, shortening the final note if needed.
  let total = 0;
  let cut = degrees.length;
  for (let i = 0; i < rhythm.length; i++) {
    if (total + rhythm[i] >= lengthBeats) {
      rhythm[i] = Math.max(0.25, lengthBeats - total);
      cut = i + 1;
      break;
    }
    total += rhythm[i];
  }
  degrees.length = cut;
  rhythm.length = cut;

  resolveLeaps(degrees, mood.leapRule.maxLeap);
  applyCadence(degrees, rhythm, mood, cadenceType);

  return { degrees, rhythm };
}

function degreesToMidi(mood, voice, degrees) {
  const reg = mood.registers[voice];
  return degrees.map((d) => {
    if (d === 'R') return null;
    const raw = degreeToMidi(mood.meta.tonicMidi, mood.meta.scale, d);
    return reg ? fitToRegister(raw, reg.low, reg.high) : raw;
  });
}

// Assembles a full piece by walking the structure's section chain once
// (intro -> A -> A-variation -> B -> fade, per the mood's structure CSV).
export function generatePiece(mood, structure, rng = Math.random) {
  const events = [];
  const sectionMarkers = [];
  const voices = Object.keys(mood.registers);
  let cursorBeat = 0;

  const byName = Object.fromEntries(structure.sections.map((s) => [s.name, s]));
  let current = structure.sections[0];
  const visited = new Set();

  while (current && !visited.has(current.name)) {
    visited.add(current.name);
    sectionMarkers.push({ name: current.name, startBeat: cursorBeat });
    const activity = structure.voiceActivity[current.name] || {};
    const cadenceType = structure.cadence[current.name];

    for (const voice of voices) {
      if (!activity[voice]) continue;
      const { degrees, rhythm } = generatePhrase(mood, voice, current.name, current.bars, cadenceType, rng);
      const midis = degreesToMidi(mood, voice, degrees);
      let t = cursorBeat;
      for (let i = 0; i < midis.length; i++) {
        events.push({ voice, startBeat: t, durBeat: rhythm[i], midi: midis[i] });
        t += rhythm[i];
      }
    }

    cursorBeat += current.bars;
    current = current.next ? byName[current.next] : null;
  }

  return { events, sectionMarkers, totalBeats: cursorBeat };
}
