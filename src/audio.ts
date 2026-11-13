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
  voice: Number(pref.get('vol.voice') ?? 0.6),
};

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

function play(path: string, gain: number, opts: { rate?: number; offset?: number; duration?: number } = {}) {
  if (!ctx || gain <= 0) return;
  void load(path).then((buf) => {
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
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
  el.play().then(() => fade(el, volume.music)).catch(() => {});
}

// ---------- babble ----------
interface Babble { every: number; rate: number; duration: number; skip?: number }
const BABBLE: Record<string, Babble> = {
  logs: { every: 2, rate: 1.15, duration: 0.09 },
  metrics: { every: 4, rate: 0.95, duration: 0.07 },
  traces: { every: 3, rate: 1.05, duration: 0.1, skip: 0.4 }, // only some of it gets sampled
  dba: { every: 2, rate: 1.3, duration: 0.07 },
  collector: { every: 2, rate: 1.2, duration: 0.08 },
  baggage: { every: 3, rate: 1.0, duration: 0.09 },
  monitoring: { every: 4, rate: 0.9, duration: 0.1 },
};
const VOICE_OF: Record<string, string> = { stranger: 'collector' };

/** One blip for character index i of a line, if this speaker talks on that character. */
export function babble(speaker: string, i: number, ch: string) {
  const voice = VOICE_OF[speaker] ?? speaker;
  const b = BABBLE[voice];
  if (!b || i % b.every || !/[\p{L}\p{N}]/u.test(ch)) return;
  if (b.skip && Math.random() < b.skip) return;
  const rate = (speaker === 'stranger' ? 0.8 : b.rate) * (0.92 + Math.random() * 0.16);
  play(`babble/${voice}`, volume.voice, { rate, offset: 0.02, duration: b.duration });
}

// ---------- settings ----------
export const getVolume = (c: Channel) => volume[c];
export function setVolume(c: Channel, v: number) {
  volume[c] = v;
  pref.set(`vol.${c}`, String(v));
  if (c === 'music' && current) current.volume = v;
}
