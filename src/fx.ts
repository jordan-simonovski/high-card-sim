// Manga-style flourishes over the portrait: onomatopoeia lettering and small particle bursts.
// Purely decorative (aria-hidden); under reduced motion the lettering fades in place and
// particles are skipped.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function layer(): HTMLElement {
  let el = document.querySelector<HTMLElement>('#fx');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'fx' });
    el.setAttribute('aria-hidden', 'true');
    document.querySelector('#stage')!.appendChild(el);
  }
  return el;
}

/** Where the character's head is, in viewport px (falls back to centre-top). */
function anchor() {
  const s = document.querySelector<HTMLElement>('#sprite:not([hidden])') ?? document.querySelector<HTMLElement>('#card:not([hidden])');
  const r = s?.getBoundingClientRect();
  if (!r || !r.width) return { x: innerWidth / 2, y: innerHeight * 0.3, w: 240 };
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.18, w: r.width };
}

function spawn(el: HTMLElement, ms: number) {
  layer().appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Big lettered sound effect next to the character's head. */
export function sfxText(text: string, opts: { color: string; side?: 1 | -1; tilt?: number; size?: number; className?: string }) {
  const a = anchor();
  const side = opts.side ?? (Math.random() < 0.5 ? -1 : 1);
  const el = Object.assign(document.createElement('span'), { className: `onomato ${opts.className ?? ''}`, textContent: text });
  el.style.left = `${Math.min(innerWidth - 80, Math.max(80, a.x + side * Math.min(a.w * 0.45, 220)))}px`;
  el.style.top = `${Math.max(70, a.y - 20)}px`;
  el.style.setProperty('--c', opts.color);
  el.style.setProperty('--tilt', `${opts.tilt ?? side * 10}deg`);
  el.style.fontSize = `${opts.size ?? 54}px`;
  spawn(el, 1700);
}

/** Particles rising (hearts) or falling (drops) around the character. */
export function particles(kind: 'heart' | 'drop' | 'spark', count: number, color: string) {
  if (reduced) return;
  const a = anchor();
  for (let i = 0; i < count; i++) {
    const p = Object.assign(document.createElement('i'), { className: `particle ${kind}` });
    const set = (k: string, v: string) => p.style.setProperty(k, v);
    p.style.left = `${a.x + (Math.random() - 0.5) * a.w * 0.9}px`;
    p.style.top = `${a.y + Math.random() * 120 + (kind === 'drop' ? -40 : 60)}px`;
    set('--c', color);
    set('--s', `${(kind === 'drop' ? 10 : 14) + Math.random() * 14}px`);
    set('--dx', `${(Math.random() - 0.5) * 120}px`);
    set('--d', `${0.9 + Math.random() * 0.8}s`);
    set('--delay', `${Math.random() * 0.25}s`);
    spawn(p, 2200);
  }
}

/** Gloom lines behind a sad or crushed character. */
export function gloom() {
  if (reduced) return;
  const a = anchor();
  const el = Object.assign(document.createElement('div'), { className: 'gloom' });
  el.style.left = `${a.x - a.w * 0.4}px`;
  el.style.top = `${a.y - 30}px`;
  el.style.width = `${a.w * 0.8}px`;
  spawn(el, 1600);
}

/** The cross-shaped anger vein, drawn, next to the head. */
export function vein(color = '#e5484d') {
  const a = anchor();
  const el = document.createElement('span');
  el.className = 'vein';
  el.innerHTML = '<svg viewBox="0 0 40 40"><path d="M14 4c0 6 2 9 6 10M26 4c0 6-2 9-6 10M14 36c0-6 2-9 6-10M26 36c0-6-2-9-6-10M4 14c6 0 9 2 10 6M4 26c6 0 9-2 10-6M36 14c-6 0-9 2-10 6M36 26c-6 0-9-2-10-6" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>';
  el.style.left = `${a.x + Math.min(a.w * 0.22, 110)}px`;
  el.style.top = `${a.y - 30}px`;
  el.style.color = color;
  spawn(el, 1400);
}

// ---------- the vocabulary ----------
const GOOD = ['DOKI!', 'DOKI DOKI', 'KYUN!'];
export function goodChoice(color: string) {
  sfxText(GOOD[Math.floor(Math.random() * GOOD.length)], { color, size: 58 });
  particles('heart', 9, color);
}
export function badChoice() {
  sfxText('GAAN…', { color: '#5b6b9a', size: 52, className: 'heavy' });
  particles('drop', 7, '#7fb2ff');
}
export function keptMoment(color: string) {
  sfxText('KIRA!', { color, size: 46 });
  particles('spark', 8, '#ffd76e');
}

let lastMood = '';
/** A flourish when a speaker's expression changes (not on every line). */
export function moodChange(speaker: string, mood: string | undefined, color: string) {
  const key = `${speaker}:${mood ?? 'neutral'}`;
  if (key === lastMood) return;
  lastMood = key;
  if (mood === 'blush') { sfxText('KYUN', { color, size: 44 }); particles('heart', 4, color); }
  else if (mood === 'surprised') sfxText('!?', { color: '#3a1d4a', size: 64, className: 'heavy' });
  else if (mood === 'annoyed') vein();
  else if (mood === 'sad') { sfxText('zuun…', { color: '#5b6b9a', size: 40, className: 'heavy' }); gloom(); }
}
export function resetMood() {
  lastMood = '';
}
