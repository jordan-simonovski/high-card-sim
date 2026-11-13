// Music, sound effects and character babble. All files are pre-generated (tools/audio/
// generate.mjs) and served from /audio. Nothing plays until the first click, because browsers
// block audio before a user gesture.

const BASE = '/audio';
type Channel = 'music' | 'sfx' | 'voice';

const pref = {
  get: (k: string) => { try { return localStorage.getItem(`hc.${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`hc.${k}`, v); } catch { /* private mode */ } },
};
const volume: Record<Channel, number> = {
  music: Number(pref.get('vol.music') ?? 0.5),
  sfx: Number(pref.get('vol.sfx') ?? 0.7),
  voice: Number(pref.get('vol.voice') ?? 0.35),
};
let muted = pref.get('muted') === '1';

let ctx: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

/** Call from any user gesture; safe to call repeatedly. */
export function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if (pendingMusic !== undefined) playMusic(pendingMusic);
}

function load(path: string) {
  if (!buffers.has(path))
    buffers.set(
      path,
      fetch(`${BASE}/${path}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx!.decodeAudioData(b))
        .catch(() => undefined), // missing audio is never fatal
    );
  return buffers.get(path)!;
}

function play(path: string, gain: number, opts: { rate?: number; offset?: number; duration?: number; lowpass?: number } = {}) {
  if (!ctx || gain <= 0 || muted) return;
  void load(path).then((buf) => {
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    let node: AudioNode = src;
    if (opts.lowpass) {
      // Round off the treble so short voices sound warm rather than squeaky.
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node = node.connect(f);
    }
    if (opts.duration) {
      // A quick attack and fade so clipped syllables don't click.
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + opts.duration);
    } else g.gain.value = gain;
    node.connect(g).connect(ctx.destination);
    src.start(0, opts.offset ?? 0, opts.duration);
  });
}

export const sfx = (id: string) => play(`sfx/${id}`, volume.sfx);

// ---------- music: two looping elements, crossfaded ----------
let current: HTMLAudioElement | undefined;
let currentId = 'none';
let pendingMusic: string | undefined;
const FADE_MS = 900;

function fade(el: HTMLAudioElement, to: number, done?: () => void) {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

/** Crossfade to a track ("none" fades out). Before the first gesture it's queued. */
export function playMusic(id: string) {
  if (!ctx) {
    pendingMusic = id;
    return;
  }
  pendingMusic = undefined;
  if (id === currentId) return;
  currentId = id;
  const old = current;
  if (old) fade(old, 0, () => old.pause());
  current = undefined;
  if (id === 'none') return;
  const el = new Audio(`${BASE}/music/${id}.mp3`);
  el.loop = true;
  el.volume = 0;
  current = el;
  if (muted) return; // starts when sound is switched back on
  el.play().then(() => fade(el, volume.music)).catch(() => {});
}

// ---------- babble ----------
interface Babble { every: number; rate: number; duration: number; skip?: number }
// Soft and sparse: a blip every few letters at or below natural pitch reads as a voice; a blip
// every other letter at a higher pitch reads as an alarm.
const BABBLE: Record<string, Babble> = {
  dba: { every: 4, rate: 1.0, duration: 0.09 }, // the reference voice
  logs: { every: 4, rate: 1.0, duration: 0.1 }, // still the chattiest (longest lines)
  metrics: { every: 6, rate: 0.9, duration: 0.08 },
  traces: { every: 5, rate: 0.96, duration: 0.11, skip: 0.4 }, // only some of it gets sampled
  collector: { every: 4, rate: 1.03, duration: 0.09 },
  baggage: { every: 5, rate: 0.94, duration: 0.1 },
  monitoring: { every: 6, rate: 0.88, duration: 0.11 },
};
const VOICE_OF: Record<string, string> = { stranger: 'collector' };

/** One blip for character index i of a line, if this speaker talks on that character. */
export function babble(speaker: string, i: number, ch: string) {
  const voice = VOICE_OF[speaker] ?? speaker;
  const b = BABBLE[voice];
  if (!b || i % b.every || !/[\p{L}\p{N}]/u.test(ch)) return;
  if (b.skip && Math.random() < b.skip) return;
  const rate = (speaker === 'stranger' ? 0.72 : b.rate) * (0.95 + Math.random() * 0.1);
  play(`babble/${voice}`, volume.voice, { rate, offset: 0.02, duration: b.duration, lowpass: 2200 });
}

// ---------- settings ----------
export const getVolume = (c: Channel) => volume[c];
export const isMuted = () => muted;
/** Master sound switch: silences effects and voices and pauses the music. */
export function setMuted(on: boolean) {
  muted = on;
  pref.set('muted', on ? '1' : '0');
  if (current) {
    if (on) current.pause();
    else void current.play().catch(() => {});
  }
}
export function setVolume(c: Channel, v: number) {
  volume[c] = v;
  pref.set(`vol.${c}`, String(v));
  if (c === 'music' && current) current.volume = v;
}
