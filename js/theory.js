// Music-theory constants + pitch math.
// These scale patterns are genre-standard constants (not per-mood content), so they
// live in code. Everything that actually varies per mood (which mode, tonic, weights,
// motifs, register) lives in the CSV data files.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "C4" -> 60 (scientific pitch notation, MIDI note number)
export function noteNameToMidi(name) {
  const m = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const [, letter, accidental, octaveStr] = m;
  let semitone = PITCH_CLASS[letter.toUpperCase()];
  if (accidental === '#') semitone += 1;
  if (accidental === 'b') semitone -= 1;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + semitone;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Map an integer scale degree (can be negative or > scale length) to a semitone
// offset from the tonic, wrapping into octaves as needed.
export function degreeToSemitoneOffset(degree, scaleName) {
  const scale = SCALES[scaleName] || SCALES.major;
  const len = scale.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return octave * 12 + scale[idx];
}

export function degreeToMidi(tonicMidi, scaleName, degree) {
  return tonicMidi + degreeToSemitoneOffset(degree, scaleName);
}

// Shift a MIDI note by octaves until it falls inside [low, high]. If the note's
// natural placement is outside the register, pick whichever octave lands closest
// to the register's center rather than clamping numerically (keeps intervals intact).
export function fitToRegister(midi, low, high) {
  const center = (low + high) / 2;
  let best = midi;
  let bestDist = Math.abs(midi - center);
  for (let oct = -6; oct <= 6; oct++) {
    const candidate = midi + oct * 12;
    if (candidate < low || candidate > high) continue;
    const dist = Math.abs(candidate - center);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

export function weightedPick(items, weightFn, rng = Math.random) {
  const total = items.reduce((sum, it) => sum + weightFn(it), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const it of items) {
    r -= weightFn(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
