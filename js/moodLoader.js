// Parses the tagged-row mood + structure CSVs into structured JS objects.
//
// Schema note (tradeoff, documented here since it's not obvious from the brief's
// suggested file layout): the infographic describes FOUR sub-tables per mood
// (interval_weights, leap_rules, register, seed_motifs) and THREE per structure
// file (section_sequence, voice_activity, cadence_map). Rather than splitting
// each mood into 4+ separate CSVs, every /moods/<mood>.csv and
// /structure/<mood>_structure.csv is a single flat CSV with a `type` column that
// tags which sub-table each row belongs to. This matches the brief's suggested
// "one file per mood" layout while still keeping each sub-table distinct and
// swap/editable in a text editor (just filter/sort by the `type` column).

import { fetchCSV } from './csv.js';
import { noteNameToMidi } from './theory.js';

// Canonical three-voice texture per the v2 revision: bass / chords / lead (melody).
// `rhythm` is an optional 4th percussive/pulse layer (combat's drive), and moods may
// declare additional voices beyond this list (e.g. combat_boss's high "solo" voice,
// only active in its break section) — the loader below accepts any voice name found
// in the CSV, this list only seeds the four common ones so they always exist.
const VOICES = ['bass', 'chords', 'lead', 'rhythm'];

function pipeList(str) {
  return (str || '').split('|').map((s) => s.trim()).filter((s) => s !== '');
}

// A degree token is 'R' (rest), an integer (single note), or "a+b" (a chord: two or
// more scale degrees stacked and sounded together — used sparingly, dyads mostly, to
// keep harmonic density conservative per the buzzer-hardware-safe constraint).
function parseDegreeToken(tok) {
  if (tok === 'R') return 'R';
  if (tok.includes('+')) return tok.split('+').map((d) => parseInt(d, 10));
  return parseInt(tok, 10);
}

export async function loadMood(id) {
  const rows = await fetchCSV(`moods/${id}.csv`);
  const mood = {
    id,
    meta: {},
    intervalWeights: [],
    leapRule: { maxLeap: 3, resolveDirection: 'opposite' },
    registers: {},
    motifs: {}, // voice -> [{id, section, degrees:[...], rhythm:[...]}]
  };
  VOICES.forEach((v) => (mood.motifs[v] = []));

  for (const row of rows) {
    switch (row.type) {
      case 'meta':
        mood.meta[row.key] = row.value;
        break;
      case 'interval_weight':
        mood.intervalWeights.push({
          degree: parseInt(row.degree, 10),
          weightStrong: parseFloat(row.weight_strong),
          weightWeak: parseFloat(row.weight_weak),
        });
        break;
      case 'leap_rule':
        mood.leapRule = {
          maxLeap: parseInt(row.max_leap, 10),
          resolveDirection: row.resolve_direction || 'opposite',
        };
        break;
      case 'register':
        mood.registers[row.voice] = {
          low: noteNameToMidi(row.low_note),
          high: noteNameToMidi(row.high_note),
          waveform: row.waveform || 'triangle',
          gain: row.gain ? parseFloat(row.gain) : 0.2,
          // Optional vibrato: a second LFO oscillator modulating .detune (see synth.js).
          vibratoRate: row.vibrato_rate ? parseFloat(row.vibrato_rate) : 0,
          vibratoDepth: row.vibrato_depth ? parseFloat(row.vibrato_depth) : 0,
        };
        break;
      case 'seed_motif':
        if (!mood.motifs[row.voice]) mood.motifs[row.voice] = [];
        mood.motifs[row.voice].push({
          id: row.motif_id,
          section: row.section,
          degrees: pipeList(row.degrees).map(parseDegreeToken),
          rhythm: pipeList(row.rhythm).map((r) => parseFloat(r)),
        });
        break;
      default:
        break;
    }
  }

  mood.meta.tonicMidi = noteNameToMidi(mood.meta.tonic || 'C3');
  mood.meta.tempo = parseFloat(mood.meta.tempo || '90');
  mood.meta.scale = mood.meta.mode || 'natural_minor';
  mood.meta.contour = pipeList(mood.meta.contour).map((n) => parseInt(n, 10));

  return mood;
}

export async function loadStructure(id) {
  const rows = await fetchCSV(`structure/${id}_structure.csv`);
  const structure = {
    sections: [], // [{name, bars, next}]
    voiceActivity: {}, // section -> {bass:bool, chords:bool, lead:bool, rhythm:bool, ...}
    cadence: {}, // section -> 'resolved' | 'unresolved'
  };

  for (const row of rows) {
    switch (row.type) {
      case 'section_sequence':
        structure.sections.push({
          name: row.section,
          bars: parseInt(row.bars, 10),
          next: row.next || '',
        });
        break;
      case 'voice_activity':
        if (!structure.voiceActivity[row.section]) structure.voiceActivity[row.section] = {};
        structure.voiceActivity[row.section][row.voice_id] = row.active === '1';
        break;
      case 'cadence_map':
        structure.cadence[row.section_end] = row.cadence_type;
        break;
      default:
        break;
    }
  }

  return structure;
}

export const VOICE_LIST = VOICES;
