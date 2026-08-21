import { loadMood, loadStructure } from './moodLoader.js';
import { generatePiece } from './generator.js';
import { AudioEngine } from './synth.js';
import { registerScreen, setScreen, getScreen } from './hotkeys.js';

const MOOD_LIST = [
  { id: 'dungeon', digit: '1', label: 'DUNGEON / GRAVEYARD', desc: 'tense, claustrophobic' },
  { id: 'wilderness', digit: '2', label: 'WILDERNESS', desc: 'tense, open' },
  { id: 'combat_routine', digit: '3', label: 'COMBAT (ROUTINE)', desc: 'driving, repetitive' },
  { id: 'combat_boss', digit: '4', label: 'COMBAT (BOSS)', desc: 'driving, dramatic' },
  { id: 'triumph', digit: '5', label: 'TRIUMPH / OPENING', desc: 'major, rising, resolved' },
  { id: 'town', digit: '6', label: 'TOWN', desc: 'hurdy-gurdy drone' },
  { id: 'tavern', digit: '7', label: 'TAVERN', desc: 'irish trad, modal' },
  { id: 'camp', digit: '8', label: 'CAMP / DOWNTIME', desc: 'sparse, slow' },
];

const STORAGE_KEY = 'gdss:web:v1';
const engine = new AudioEngine();

const state = {
  loaded: {}, // id -> {mood, structure}
  currentMoodId: null,
  highlightIndex: 0,
  playToken: 0, // invalidates stale scheduling chains on stop/switch
  paused: false,
  volume: 0.6,
  sectionTimers: [],
};

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.volume === 'number') state.volume = data.volume;
  } catch (e) {
    // ignore corrupt storage
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: state.volume, lastMood: state.currentMoodId }));
  } catch (e) {
    // storage unavailable (private browsing etc) — non-fatal
  }
}

// ---------- DOM ----------

const el = {
  moodGrid: document.getElementById('mood-grid'),
  screenHome: document.getElementById('screen-home'),
  screenPlaying: document.getElementById('screen-playing'),
  screenHelp: document.getElementById('screen-help'),
  npMood: document.getElementById('np-mood'),
  npSection: document.getElementById('np-section'),
  volumeFill: document.getElementById('volume-fill'),
};

function renderMoodGrid() {
  el.moodGrid.innerHTML = '';
  MOOD_LIST.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mood-item' + (i === state.highlightIndex ? ' highlighted' : '');
    row.innerHTML = `<span class="key">${m.digit}</span><span class="label">${m.label}</span><span class="desc">${m.desc}</span>`;
    row.addEventListener('click', () => playMood(m.id));
    el.moodGrid.appendChild(row);
  });
}

function showScreen(name) {
  el.screenHome.classList.toggle('hidden', name !== 'home');
  el.screenPlaying.classList.toggle('hidden', name !== 'playing');
  el.screenHelp.classList.toggle('hidden', name !== 'help');
  setScreen(name);
}

function updateVolumeUI() {
  el.volumeFill.style.width = `${Math.round(state.volume * 100)}%`;
  engine.setVolume(state.volume);
}

// ---------- data loading ----------

async function ensureMoodLoaded(id) {
  if (state.loaded[id]) return state.loaded[id];
  const [mood, structure] = await Promise.all([loadMood(id), loadStructure(id)]);
  state.loaded[id] = { mood, structure };
  return state.loaded[id];
}

// ---------- playback ----------

function clearSectionTimers() {
  state.sectionTimers.forEach((t) => clearTimeout(t));
  state.sectionTimers = [];
}

function secondsPerBeat(tempo) {
  return 60 / tempo;
}

// Schedules one generated piece starting at `atTime` (AudioEngine context time).
// Returns the piece's duration in seconds.
function schedulePiece(mood, piece, atTime) {
  const spb = secondsPerBeat(mood.meta.tempo);
  for (const ev of piece.events) {
    const voiceConfig = mood.registers[ev.voice];
    if (!voiceConfig) continue;
    engine.playNote(voiceConfig, ev.midi, atTime + ev.startBeat * spb, ev.durBeat * spb);
  }
  return piece.totalBeats * spb;
}

function scheduleSectionLabels(mood, piece, atTime, myToken) {
  const spb = secondsPerBeat(mood.meta.tempo);
  const ctxStart = engine.ctx.currentTime;
  for (const marker of piece.sectionMarkers) {
    const delayMs = Math.max(0, (atTime - ctxStart + marker.startBeat * spb) * 1000);
    const t = setTimeout(() => {
      if (state.playToken !== myToken) return;
      el.npSection.textContent = `> ${marker.name.toUpperCase()}`;
    }, delayMs);
    state.sectionTimers.push(t);
  }
}

// Double-buffered loop: always keep the NEXT piece scheduled before the current
// one ends, so playback is continuous without relying on JS-timer precision for
// the actual audio (only for topping up the schedule queue).
function playbackLoop(id, myToken, atTime) {
  if (state.playToken !== myToken) return;
  const { mood, structure } = state.loaded[id];
  const piece = generatePiece(mood, structure);
  const duration = schedulePiece(mood, piece, atTime);
  scheduleSectionLabels(mood, piece, atTime, myToken);

  const nextStart = atTime + duration;
  const topUpDelayMs = Math.max(0, (nextStart - engine.ctx.currentTime - 2) * 1000);
  const t = setTimeout(() => playbackLoop(id, myToken, nextStart), topUpDelayMs);
  state.sectionTimers.push(t);
}

async function playMood(id) {
  engine.ensureContext();
  engine.hardStop();
  clearSectionTimers();
  state.playToken++;
  const myToken = state.playToken;
  state.currentMoodId = id;
  state.paused = false;

  const meta = MOOD_LIST.find((m) => m.id === id);
  el.npMood.textContent = meta.label;
  el.npSection.textContent = '> LOADING...';
  showScreen('playing');
  updateVolumeUI();
  persist();

  await ensureMoodLoaded(id);
  if (state.playToken !== myToken) return; // superseded by another play() while loading

  const startAt = engine.ctx.currentTime + 0.2;
  playbackLoop(id, myToken, startAt);
}

function stopPlayback() {
  state.playToken++;
  clearSectionTimers();
  engine.hardStop();
  state.currentMoodId = null;
  state.paused = false;
  showScreen('home');
}

function togglePause() {
  if (state.paused) {
    engine.resume();
    state.paused = false;
  } else {
    engine.suspend();
    state.paused = true;
  }
}

// ---------- hotkeys ----------

function moodByDigit(key) {
  return MOOD_LIST.find((m) => m.digit === key);
}

registerScreen('home', (e) => {
  const m = moodByDigit(e.key);
  if (m) {
    playMood(m.id);
    return;
  }
  switch (e.key) {
    case 'ArrowUp':
      state.highlightIndex = (state.highlightIndex - 1 + MOOD_LIST.length) % MOOD_LIST.length;
      renderMoodGrid();
      break;
    case 'ArrowDown':
      state.highlightIndex = (state.highlightIndex + 1) % MOOD_LIST.length;
      renderMoodGrid();
      break;
    case 'Enter':
      playMood(MOOD_LIST[state.highlightIndex].id);
      break;
    case 'h':
    case 'H':
    case '?':
      showScreen('help');
      break;
    default:
      break;
  }
});

registerScreen('playing', (e) => {
  const m = moodByDigit(e.key);
  if (m) {
    playMood(m.id);
    return;
  }
  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePause();
      break;
    case 's':
    case 'S':
    case 'Escape':
      stopPlayback();
      break;
    case '+':
    case '=':
      state.volume = Math.min(1, state.volume + 0.1);
      updateVolumeUI();
      persist();
      break;
    case '-':
    case '_':
      state.volume = Math.max(0, state.volume - 0.1);
      updateVolumeUI();
      persist();
      break;
    case 'h':
    case 'H':
      showScreen('help');
      break;
    default:
      break;
  }
});

registerScreen('help', () => {
  showScreen(state.currentMoodId ? 'playing' : 'home');
});

// ---------- boot ----------

loadSaved();
renderMoodGrid();
updateVolumeUI();
showScreen('home');
