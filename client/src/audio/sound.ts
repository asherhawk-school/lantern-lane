import { settings } from '../state.ts';

/**
 * All sound is synthesised with Web Audio: filtered noise for ambience, short tones for chimes.
 * Browsers only allow audio after a click or key press, so nothing plays until `unlock()` runs.
 */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: { kind: string; stop: () => void } | null = null;

function noiseBuffer(ctx: AudioContext, brown: boolean): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

function startLayer(ctx: AudioContext, out: AudioNode, brown: boolean, type: BiquadFilterType, freq: number, gain: number): () => void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, brown);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 1.5);
  src.connect(filter).connect(g).connect(out);
  src.start();
  return () => {
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    src.stop(ctx.currentTime + 1);
  };
}

export function applySound(): void {
  if (!ac || !master) return;
  const { volume, ambience: kind } = settings.value;
  master.gain.setTargetAtTime(volume, ac.currentTime, 0.05);
  if (ambience?.kind === kind) return;
  ambience?.stop();
  ambience = null;
  if (kind === 'rain') {
    const a = startLayer(ac, master, false, 'highpass', 1800, 0.05);
    const b = startLayer(ac, master, true, 'lowpass', 500, 0.35);
    ambience = { kind, stop: () => (a(), b()) };
  } else if (kind === 'room') {
    const a = startLayer(ac, master, true, 'lowpass', 260, 0.5);
    ambience = { kind, stop: a };
  }
}

/** Call from a user gesture. Safe to call repeatedly. */
export function unlock(): void {
  try {
    if (!ac) {
      ac = new AudioContext();
      master = ac.createGain();
      master.gain.value = settings.value.volume;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') void ac.resume();
    applySound();
  } catch {
    // No audio device or blocked: the app works silently.
  }
}

function tone(freq: number, at: number, length: number, gain: number, type: OscillatorType = 'triangle'): void {
  if (!ac || !master) return;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ac.createGain();
  const t = ac.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

export type Sfx = 'done' | 'soft' | 'coin' | 'click' | 'sit' | 'break';

export function play(kind: Sfx): void {
  if (!ac || settings.value.volume <= 0) return;
  switch (kind) {
    case 'done':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.14, 0.9, 0.22));
      return;
    case 'break':
      [783.99, 659.25, 523.25].forEach((f, i) => tone(f, i * 0.16, 0.7, 0.18));
      return;
    case 'soft':
      tone(880, 0, 0.5, 0.06, 'sine');
      return;
    case 'coin':
      tone(987.77, 0, 0.12, 0.14, 'square');
      tone(1318.5, 0.08, 0.3, 0.14, 'square');
      return;
    case 'sit':
      tone(220, 0, 0.12, 0.1, 'sine');
      return;
    case 'click':
      tone(660, 0, 0.06, 0.08, 'square');
      return;
  }
}
