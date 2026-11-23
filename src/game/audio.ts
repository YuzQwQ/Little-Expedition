import { getSettings } from './settings.ts';

export type Cue =
    | 'ui' | 'swing' | 'hit' | 'block' | 'parry' | 'break' | 'hurt'
    | 'ultimate' | 'coin' | 'spend' | 'wave' | 'victory' | 'defeat';

/** Shortest gap between two plays of the same cue, in milliseconds. Keeps multi-hit frames from stacking. */
const GAPS: Record<Cue, number> = {
    ui: 40, swing: 45, hit: 26, block: 60, parry: 90, break: 110, hurt: 120,
    ultimate: 250, coin: 55, spend: 70, wave: 400, victory: 600, defeat: 600,
};

interface Rig {
    ctx: AudioContext;
    out: GainNode;
}

let rig: Rig | undefined;
let noise: AudioBuffer | undefined;
const lastPlayed = new Map<Cue, number>();
let voices = 0;

function engine(): Rig | undefined {
    if (typeof window === 'undefined') return undefined;
    if (rig) return rig;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    const ctx = new Ctor();
    const out = ctx.createGain();
    out.gain.value = 0.32;
    // Every cue is a synthesized transient, so a limiter keeps a pile of hits from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    out.connect(limiter);
    limiter.connect(ctx.destination);
    rig = { ctx, out };
    return rig;
}

function noiseBuffer(ctx: AudioContext) {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return noise;
}

function envelope(ctx: AudioContext, start: number, peak: number, attack: number, duration: number) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + Math.max(0.002, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    return gain;
}

interface Tone {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain: number;
    attack?: number;
    delay?: number;
    filter?: { type: BiquadFilterType; frequency: number; endFrequency?: number; q?: number };
}

function tone(ctx: AudioContext, out: GainNode, at: number, spec: Tone) {
    const start = at + (spec.delay ?? 0);
    const oscillator = ctx.createOscillator();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.from, start);
    if (spec.to !== undefined && spec.to !== spec.from) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), start + spec.duration);
    }
    const gain = envelope(ctx, start, spec.gain, spec.attack ?? 0.006, spec.duration);
    oscillator.connect(gain);
    let tail: AudioNode = gain;
    if (spec.filter) {
        const filter = ctx.createBiquadFilter();
        filter.type = spec.filter.type;
        filter.frequency.setValueAtTime(spec.filter.frequency, start);
        if (spec.filter.endFrequency !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.filter.endFrequency), start + spec.duration);
        }
        filter.Q.value = spec.filter.q ?? 1;
        gain.connect(filter);
        tail = filter;
    }
    tail.connect(out);
    oscillator.start(start);
    oscillator.stop(start + spec.duration + 0.03);
    oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        if (tail !== gain) tail.disconnect();
    };
}

interface Hiss {
    from: number;
    to?: number;
    duration: number;
    gain: number;
    q?: number;
    type?: BiquadFilterType;
    delay?: number;
}

function hiss(ctx: AudioContext, out: GainNode, at: number, spec: Hiss) {
    const start = at + (spec.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = spec.type ?? 'bandpass';
    filter.frequency.setValueAtTime(spec.from, start);
    if (spec.to !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.to), start + spec.duration);
    }
    filter.Q.value = spec.q ?? 1;
    const gain = envelope(ctx, start, spec.gain, 0.004, spec.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(start);
    source.stop(start + spec.duration + 0.03);
    source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
    };
}

const VOICES: Record<Cue, (ctx: AudioContext, out: GainNode, at: number) => void> = {
    ui: (ctx, out, at) => tone(ctx, out, at, { type: 'square', from: 760, to: 980, duration: 0.05, gain: 0.04 }),
    swing: (ctx, out, at) => {
        hiss(ctx, out, at, { from: 1900, to: 420, duration: 0.17, gain: 0.13, q: 0.9 });
        hiss(ctx, out, at, { from: 620, to: 240, duration: 0.12, gain: 0.05, q: 0.7, delay: 0.03 });
    },
    hit: (ctx, out, at) => {
        hiss(ctx, out, at, { from: 1250, to: 380, duration: 0.09, gain: 0.16, q: 1.1 });
        tone(ctx, out, at, { type: 'sine', from: 190, to: 90, duration: 0.08, gain: 0.12 });
    },
    block: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'triangle', from: 330, to: 260, duration: 0.07, gain: 0.1 });
        hiss(ctx, out, at, { from: 900, to: 500, duration: 0.06, gain: 0.07, q: 2 });
    },
    parry: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'square', from: 1760, duration: 0.05, gain: 0.05 });
        tone(ctx, out, at, { type: 'square', from: 2637, duration: 0.06, gain: 0.035, delay: 0.02 });
        tone(ctx, out, at, { type: 'sine', from: 3520, to: 2400, duration: 0.22, gain: 0.045, delay: 0.01 });
    },
    break: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'sine', from: 120, to: 48, duration: 0.26, gain: 0.2 });
        hiss(ctx, out, at, { from: 800, to: 180, duration: 0.22, gain: 0.12, q: 0.8 });
    },
    hurt: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'sawtooth', from: 250, to: 110, duration: 0.2, gain: 0.09,
            filter: { type: 'lowpass', frequency: 1200, endFrequency: 500 } });
        hiss(ctx, out, at, { from: 500, to: 200, duration: 0.12, gain: 0.07, q: 0.6 });
    },
    ultimate: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'sawtooth', from: 140, to: 620, duration: 0.42, gain: 0.11,
            filter: { type: 'lowpass', frequency: 400, endFrequency: 2600, q: 4 } });
        hiss(ctx, out, at, { from: 300, to: 1600, duration: 0.4, gain: 0.08, type: 'highpass' });
        tone(ctx, out, at, { type: 'sine', from: 90, to: 58, duration: 0.3, gain: 0.14, delay: 0.34 });
    },
    coin: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'triangle', from: 1046, duration: 0.1, gain: 0.07 });
        tone(ctx, out, at, { type: 'triangle', from: 1568, duration: 0.16, gain: 0.055, delay: 0.06 });
    },
    spend: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'triangle', from: 784, to: 523, duration: 0.12, gain: 0.06 });
        tone(ctx, out, at, { type: 'sine', from: 392, to: 262, duration: 0.1, gain: 0.05, delay: 0.06 });
    },
    wave: (ctx, out, at) => {
        tone(ctx, out, at, { type: 'sine', from: 98, duration: 0.7, gain: 0.1, attack: 0.06 });
        tone(ctx, out, at, { type: 'sine', from: 147, duration: 0.6, gain: 0.045, attack: 0.08, delay: 0.01 });
    },
    victory: (ctx, out, at) => {
        [523, 659, 784, 1046].forEach((from, index) =>
            tone(ctx, out, at, { type: 'triangle', from, duration: 0.22, gain: 0.07, delay: index * 0.12 }));
    },
    defeat: (ctx, out, at) => {
        [392, 330, 262].forEach((from, index) =>
            tone(ctx, out, at, { type: 'sine', from, duration: 0.3, gain: 0.075, delay: index * 0.16 }));
    },
};

/** Browsers only start audio from a gesture, so the first tap or key press primes the context. */
export function unlockAudio() {
    const rigged = engine();
    if (rigged && rigged.ctx.state === 'suspended') void rigged.ctx.resume();
}

export function playCue(cue: Cue) {
    if (!getSettings().sound) return;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (now - (lastPlayed.get(cue) ?? -Infinity) < GAPS[cue]) return;
    if (voices >= 12) return;
    const rigged = engine();
    if (!rigged) return;
    lastPlayed.set(cue, now);
    if (rigged.ctx.state === 'suspended') void rigged.ctx.resume();
    voices += 1;
    window.setTimeout(() => { voices -= 1; }, 400);
    VOICES[cue](rigged.ctx, rigged.out, rigged.ctx.currentTime + 0.001);
}
