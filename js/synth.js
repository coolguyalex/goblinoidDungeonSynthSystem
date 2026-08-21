// Web Audio playback layer. OscillatorNode + GainNode only, per the brief
// (no third-party audio libraries, no sample/noise buffers).

import { midiToFreq } from './theory.js';

const ATTACK = 0.015;
const RELEASE_FRACTION = 0.25; // fraction of note duration spent releasing

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.activeNodes = [];
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Schedules one note. midi === null is a rest (no node created).
  playNote(voiceConfig, midi, startTime, durationSec) {
    if (midi == null) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = voiceConfig.waveform;
    osc.frequency.value = midiToFreq(midi);

    const gain = ctx.createGain();
    const peak = voiceConfig.gain;
    const releaseTime = Math.max(0.03, durationSec * RELEASE_FRACTION);
    const sustainEnd = Math.max(startTime + ATTACK, startTime + durationSec - releaseTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + ATTACK);
    gain.gain.setValueAtTime(peak, sustainEnd);
    gain.gain.linearRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain).connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);

    this.activeNodes.push(osc);
    osc.onended = () => {
      const idx = this.activeNodes.indexOf(osc);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
    };
  }

  // Immediately silences everything (used by the Stop hotkey / mood switch).
  hardStop() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const osc of this.activeNodes) {
      try {
        osc.stop(now + 0.03);
      } catch (e) {
        // already stopped
      }
    }
    this.activeNodes = [];
  }
}
