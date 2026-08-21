import { loadMood, loadStructure } from './moodLoader.js';
import { generatePiece } from './generator.js';
import { AudioEngine } from './synth.js';
import { registerScreen, setScreen, getScreen } from './hotkeys.js';
import { randomSeed, mulberry32 } from './rng.js';

const MOOD_LIST = [
  { id: 'dungeon', digit: '1', label: 'DUNGEON / GRAVEYARD', desc: 'anxious, tomb-tense' },
  { id: 'wilderness', digit: '2', label: 'WILDERNESS', desc: 'open, sustained' },
  { id: 'combat_routine', digit: '3', label: 'COMBAT (ROUTINE)', desc: 'driving, repetitive' },
  { id: 'combat_boss', digit: '4', label: 'COMBAT (BOSS)', desc: 'driving, operatic break' },
  { id: 'triumph', digit: '5', label: 'TRIUMPH / OPENING', desc: 'epic, resolved' },
  { id: 'town', digit: '6', label: 'TOWN', desc: 'hurdy-gurdy jig' },
  { id: 'tavern', digit: '7', label: 'TAVERN', desc: 'irish trad, modal' },
  { id: 'camp', digit: '8', label: 'CAMP / DOWNTIME', desc: 'sparse, slow' },
];

const STORAGE_KEY = 'gdss:web:v2';
const MAX_SAVED_TAKES = 50;
const engine = new AudioEngine();

const state = {
  loaded: {}, // id -> {mood, structure}
  currentMoodId: null,
  highlightIndex: 0,
  playToken: 0, // invalidates stale scheduling chains on stop/switch
  paused: false,
  volume: 0.6,
  sectionTimers: [],
  flashTimer: null,

  // Transport / take state
  loop: false, // default OFF: play the section-sequence once through, then stop
  pendingStopAfterCurrent: false, // set by "fade out on end" — don't schedule another cycle
  rng: Math.random,
  currentSeed: null,
  pieceEndAt: 0, // engine.ctx time the currently-scheduled piece ends

  savedTakes: [], // [{id, moodId, seed, label, savedAt}]
  savedHighlightIndex: 0,
};

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.volume === 'number') state.volume = data.volume;
    if (typeof data.loop === 'boolean') state.loop = data.loop;
    if (Array.isArray(data.savedTakes)) state.savedTakes = data.savedTakes;
  } catch (e) {
    // ignore corrupt storage
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        volume: state.volume,
        lastMood: state.currentMoodId,
        loop: state.loop,
        savedTakes: state.savedTakes,
      })
    );
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
  screenSaved: document.getElementById('screen-saved'),
  npMood: document.getElementById('np-mood'),
  npSection: document.getElementById('np-section'),
  volumeFill: document.getElementById('volume-fill'),
  loopIndicator: document.getElementById('loop-indicator'),
  flashMsg: document.getElementById('flash-msg'),
  savedList: document.getElementById('saved-list'),
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
  el.screenSaved.classList.toggle('hidden', name !== 'saved');
  setScreen(name);
  if (name === 'saved') renderSavedList();
}

function updateVolumeUI() {
  el.volumeFill.style.width = `${Math.round(state.volume * 100)}%`;
  engine.setVolume(state.volume);
}

function updateTransportUI() {
  el.loopIndicator.textContent = `LOOP: ${state.loop ? 'ON' : 'OFF'}`;
  el.loopIndicator.classList.toggle('on', state.loop);
}

function flashMessage(text) {
  if (state.flashTimer) clearTimeout(state.flashTimer);
  el.flashMsg.textContent = text;
  el.flashMsg.classList.add('show');
  state.flashTimer = setTimeout(() => el.flashMsg.classList.remove('show'), 1800);
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
//
// Default behavior (state.loop === false) is to play the section-sequence ONCE and
// stop — the loop-continuation decision is made ~2s before the current piece ends
// (not up front), so toggling Loop or arming "fade out on end" mid-playback takes
// effect on the very next boundary rather than only on the piece after that.
function playbackLoop(id, myToken, atTime) {
  if (state.playToken !== myToken) return;
  const { mood, structure } = state.loaded[id];
  const piece = generatePiece(mood, structure, state.rng);
  const duration = schedulePiece(mood, piece, atTime);
  scheduleSectionLabels(mood, piece, atTime, myToken);

  const pieceEndAt = atTime + duration;
  state.pieceEndAt = pieceEndAt;

  const decisionDelayMs = Math.max(0, (pieceEndAt - engine.ctx.currentTime - 2) * 1000);
  const t = setTimeout(() => {
    if (state.playToken !== myToken) return;
    if (state.loop && !state.pendingStopAfterCurrent) {
      playbackLoop(id, myToken, pieceEndAt);
    } else {
      const finalDelayMs = Math.max(0, (pieceEndAt - engine.ctx.currentTime + 0.4) * 1000);
      const t2 = setTimeout(() => {
        if (state.playToken === myToken) stopPlayback();
      }, finalDelayMs);
      state.sectionTimers.push(t2);
    }
  }, decisionDelayMs);
  state.sectionTimers.push(t);
}

// id: mood id. opts.seed: pin a specific seed (reproduces one exact take, e.g. when
// replaying a saved take); omitted means "fresh take" (new random seed) — this is
// also what powers the reseed hotkey, since it's just playMood(currentMoodId) again.
async function playMood(id, opts = {}) {
  engine.ensureContext();
  engine.hardStop();
  engine.resetFade();
  clearSectionTimers();
  state.playToken++;
  const myToken = state.playToken;
  state.currentMoodId = id;
  state.paused = false;
  state.pendingStopAfterCurrent = false;
  state.currentSeed = opts.seed != null ? opts.seed : randomSeed();
  state.rng = mulberry32(state.currentSeed);

  const meta = MOOD_LIST.find((m) => m.id === id);
  el.npMood.textContent = meta.label;
  el.npSection.textContent = '> LOADING...';
  showScreen('playing');
  updateVolumeUI();
  updateTransportUI();
  persist();

  await ensureMoodLoaded(id);
  if (state.playToken !== myToken) return; // superseded by another play() while loading

  const startAt = engine.ctx.currentTime + 0.2;
  playbackLoop(id, myToken, startAt);
}

function reseedCurrent() {
  if (!state.currentMoodId) return;
  playMood(state.currentMoodId); // no seed opt -> fresh random take
  flashMessage('REROLLED');
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

function toggleLoop() {
  state.loop = !state.loop;
  if (state.loop) state.pendingStopAfterCurrent = false; // re-arm continuation
  updateTransportUI();
  persist();
  flashMessage(state.loop ? 'LOOP ON' : 'LOOP OFF');
}

function fadeInNow() {
  if (!state.currentMoodId) return;
  engine.fadeIn(2);
  flashMessage('FADING IN');
}

// Manual mid-playback fade: wraps up the current listen right now, smoothly.
function fadeOutNow() {
  if (!state.currentMoodId) return;
  state.pendingStopAfterCurrent = true;
  const dur = 2.5;
  engine.fadeOut(dur);
  const t = setTimeout(() => {
    if (state.currentMoodId) stopPlayback();
  }, (dur + 0.3) * 1000);
  state.sectionTimers.push(t);
  flashMessage('FADING OUT');
}

// Graceful end for loop mode: let the CURRENT cycle finish, timing the fade to land
// exactly on its natural end, rather than a hard loop-cutoff. (If not looping, this
// piece was already going to stop at its end, so it just times a fade to match.)
function fadeOutOnEnd() {
  if (!state.currentMoodId) return;
  state.pendingStopAfterCurrent = true;
  const remain = Math.max(0.5, state.pieceEndAt - engine.ctx.currentTime);
  const fadeDur = Math.min(remain, 4);
  const startDelay = Math.max(0, remain - fadeDur);
  const t = setTimeout(() => {
    if (state.currentMoodId) engine.fadeOut(fadeDur);
  }, startDelay * 1000);
  state.sectionTimers.push(t);
  flashMessage('FADING OUT AT CYCLE END');
}

// ---------- saved takes ----------

function saveCurrentTake() {
  if (!state.currentMoodId || state.currentSeed == null) return;
  const meta = MOOD_LIST.find((m) => m.id === state.currentMoodId);
  const entry = {
    id: `t_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    moodId: state.currentMoodId,
    seed: state.currentSeed,
    label: meta.label,
    savedAt: Date.now(),
  };
  state.savedTakes.unshift(entry);
  if (state.savedTakes.length > MAX_SAVED_TAKES) state.savedTakes.length = MAX_SAVED_TAKES;
  persist();
  flashMessage(`SAVED — ${meta.label}`);
}

function playSavedTake(entry) {
  playMood(entry.moodId, { seed: entry.seed });
}

function deleteSavedTake(id) {
  state.savedTakes = state.savedTakes.filter((t) => t.id !== id);
  if (state.savedHighlightIndex >= state.savedTakes.length) {
    state.savedHighlightIndex = Math.max(0, state.savedTakes.length - 1);
  }
  persist();
  renderSavedList();
}

function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderSavedList() {
  el.savedList.innerHTML = '';
  if (state.savedTakes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-empty';
    empty.textContent = 'No saved takes yet — press K while a mood is playing to keep one.';
    el.savedList.appendChild(empty);
    return;
  }
  state.savedTakes.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'saved-item' + (i === state.savedHighlightIndex ? ' highlighted' : '');
    row.innerHTML = `<span class="label">${t.label}</span><span class="desc">seed ${t.seed} · ${formatDate(t.savedAt)}</span>`;
    row.addEventListener('click', () => playSavedTake(t));
    el.savedList.appendChild(row);
  });
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
    case 'v':
    case 'V':
      showScreen('saved');
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
    case 'r':
    case 'R':
      reseedCurrent();
      break;
    case 'k':
    case 'K':
      saveCurrentTake();
      break;
    case 'l':
    case 'L':
      toggleLoop();
      break;
    case 'f':
    case 'F':
      fadeOutNow();
      break;
    case 'i':
    case 'I':
      fadeInNow();
      break;
    case 'e':
    case 'E':
      fadeOutOnEnd();
      break;
    case 'v':
    case 'V':
      showScreen('saved');
      break;
    case 'h':
    case 'H':
      showScreen('help');
      break;
    default:
      break;
  }
});

registerScreen('saved', (e) => {
  switch (e.key) {
    case 'ArrowUp':
      if (state.savedTakes.length > 0) {
        state.savedHighlightIndex = (state.savedHighlightIndex - 1 + state.savedTakes.length) % state.savedTakes.length;
        renderSavedList();
      }
      break;
    case 'ArrowDown':
      if (state.savedTakes.length > 0) {
        state.savedHighlightIndex = (state.savedHighlightIndex + 1) % state.savedTakes.length;
        renderSavedList();
      }
      break;
    case 'Enter':
      if (state.savedTakes[state.savedHighlightIndex]) playSavedTake(state.savedTakes[state.savedHighlightIndex]);
      break;
    case 'd':
    case 'D':
      if (state.savedTakes[state.savedHighlightIndex]) deleteSavedTake(state.savedTakes[state.savedHighlightIndex].id);
      break;
    case 'v':
    case 'V':
    case 'Escape':
      showScreen(state.currentMoodId ? 'playing' : 'home');
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
updateTransportUI();
showScreen('home');
