// Web Audio playback layer. OscillatorNode + GainNode only, per the brief
// (no third-party audio libraries, no sample/noise buffers).

import { midiToFreq } from './theory.js';

const ATTACK = 0.015;
const RELEASE_FRACTION = 0.25; // fraction of note duration spent releasing

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null; // user volume
    this.fadeGain = null; // pseudo-DJ fade in/out bus, separate from volume
    this.activeNodes = [];
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.fadeGain = this.ctx.createGain();
      this.fadeGain.gain.value = 1;
      this.fadeGain.connect(this.masterGain);
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

  // Pseudo-DJ transport: ramps the fade bus independently of the user's volume
  // setting, so "fade out" doesn't clobber their saved volume preference.
  fadeIn(durationSec = 1.5) {
    if (!this.fadeGain) return;
    const now = this.ctx.currentTime;
    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setValueAtTime(this.fadeGain.gain.value, now);
    this.fadeGain.gain.linearRampToValueAtTime(1, now + durationSec);
  }

  fadeOut(durationSec = 1.5) {
    if (!this.fadeGain) return;
    const now = this.ctx.currentTime;
    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setValueAtTime(this.fadeGain.gain.value, now);
    this.fadeGain.gain.linearRampToValueAtTime(0.0001, now + durationSec);
  }

  resetFade() {
    if (!this.fadeGain) return;
    this.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.fadeGain.gain.value = 1;
  }

  // Schedules one note. midi === null is a rest (no node created).
  // voiceConfig.vibratoRate/vibratoDepth (Hz / cents), when both > 0, add a second
  // LFO oscillator modulating the main oscillator's .detune — a plain Web Audio
  // vibrato. (Hardware note: the equivalent on a piezo buzzer port would be an LFO
  // modulating PWM duty cycle rather than detune — out of scope for this web build.)
  playNote(voiceConfig, midi, startTime, durationSec) {
    if (midi == null) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = voiceConfig.waveform;
    osc.frequency.value = midiToFreq(midi);

    let lfo = null;
    if (voiceConfig.vibratoRate > 0 && voiceConfig.vibratoDepth > 0) {
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = voiceConfig.vibratoRate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = voiceConfig.vibratoDepth; // cents
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start(startTime);
      lfo.stop(startTime + durationSec + 0.02);
    }

    const gain = ctx.createGain();
    const peak = voiceConfig.gain;
    const releaseTime = Math.max(0.03, durationSec * RELEASE_FRACTION);
    const sustainEnd = Math.max(startTime + ATTACK, startTime + durationSec - releaseTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + ATTACK);
    gain.gain.setValueAtTime(peak, sustainEnd);
    gain.gain.linearRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain).connect(this.fadeGain);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);

    this.activeNodes.push(osc);
    osc.onended = () => {
      const idx = this.activeNodes.indexOf(osc);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
    };
    if (lfo) {
      this.activeNodes.push(lfo);
      lfo.onended = () => {
        const idx = this.activeNodes.indexOf(lfo);
        if (idx !== -1) this.activeNodes.splice(idx, 1);
      };
    }
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
