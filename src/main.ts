// Boot: support check -> title screen (engine downloads behind it) -> story. The prologue
// needs no queries, so the engine keeps loading while it plays. The event log is the save.
import './style.css';
import { clientSupport, openDb, truthy, type Db, type Row, type Unsupported } from './db.ts';
import { openLog, type EventLog, type GameEvent } from './eventlog.ts';
import { needsQueries, nextNode, node, sceneTarget, visibleChoices, type Conditions, type Scene, type SceneNode } from './engine/scene.ts';
import { PRESETS, render, type Player, type Preset } from './engine/pronouns.ts';
import { resumePoint } from './engine/resume.ts';
import { createCharacter, playerAttributes, playerFromEvents } from './create.ts';
import { drawCard, statLines } from './sharecard.ts';
import { parseSave } from './saves.ts';
import { openConsole } from './console.ts';
import type { View } from './viz.ts';
import { incidentRows, keptTraceRows, restoreIncident } from './incident.ts';
import { caseFile, type CaseFile } from './casefile.ts';
import { babble, getVolume, isMuted, playMusic, setMuted, setVolume, sfx, unlock } from './audio.ts';
import * as fx from './fx.ts';
const { badChoice, goodChoice, keptMoment, moodChange, resetMood } = fx;
import content from 'virtual:content';

const { scenes, queries } = content;
const characters = Object.fromEntries(Object.entries(content.characters).map(([id, c]) => [id, PRESETS[c.pronouns as Preset]]));
const ENDING_COUNT = Object.values(scenes).reduce((n: number, s: Scene) => n + Object.values(s.nodes).filter((x: SceneNode) => x.ending).length, 0);
const ART = '/art';
// Vercel Web Analytics: page views only, nothing from the event log. Skipped locally, where
// the script isn't served.
if (!/^(localhost|127\.)/.test(location.hostname))
  document.head.append(Object.assign(document.createElement('script'), { defer: true, src: '/_vercel/insights/script.js' }));

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const boot = { state: 'starting' as string, replayed: 0, error: '' };
const hooks = { boot } as Record<string, unknown>;

(window as unknown as { __hc: typeof hooks }).__hc = hooks;
hooks.fx = fx; // for e2e and screenshots

let player: Player | undefined;
let log: EventLog;
let ready: Promise<Db>;
let current = { scene: 'prologue', node: '' };

// ---------- settings (per-viewer conveniences, so localStorage is fine) ----------
const pref = {
  get: (k: string) => { try { return localStorage.getItem(`hc.${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`hc.${k}`, v); } catch { /* private mode */ } },
};
let scale = Number(pref.get('scale') ?? 1);
const applyScale = () => document.documentElement.style.setProperty('--scale', String(scale));

// ---------- unsupported ----------
const WHY: Record<Unsupported, string> = {
  memory64:
    "Your browser can't speak WebAssembly Memory64 yet (Safari and iOS, we're looking at you). The pillars live in Chrome, Edge and Firefox for now.",
};

function unsupported(reason: Unsupported) {
  boot.state = 'unsupported';
  $('#loader').hidden = true;
  $('#unsupported').hidden = false;
  $('#unsupported .why').textContent = WHY[reason];
}


/** A pillar noticing you, in its own data language: Metrics ticks a counter, Traces keeps a span. */
function react(c: { character?: string; affection_delta?: number; attributes?: Record<string, string> }, speaker?: string) {
  const who = c.character ?? speaker ?? '';
  const delta = c.affection_delta ?? 0;
  let el: HTMLElement | undefined;
  if (c.attributes?.['sampling.priority'] === '1') {
    el = Object.assign(document.createElement('span'), { className: 'react' });
    el.append(Object.assign(document.createElement('span'), { className: 'bar' }), document.createTextNode('kept'));
    el.style.setProperty('--accent', content.characters.traces?.color ?? '#b69cff');
  } else if (who === 'metrics' && delta !== 0) {
    el = Object.assign(document.createElement('span'), { className: `react ${delta < 0 ? 'down' : ''}`, textContent: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` });
    el.style.setProperty('--accent', content.characters.metrics?.color ?? '#5aa9ff');
  }
  if (!el) return;
  el.setAttribute('aria-hidden', 'true');
  $('#box').appendChild(el);
  setTimeout(() => el!.remove(), 1700);
}

/** Manga flourish for how a choice landed: hearts for a good call, a crushed "GAAN…" for a bad one. */
function flourish(c: { character?: string; affection_delta?: number; attributes?: Record<string, string>; vibe?: 'good' | 'bad' }, speaker?: string) {
  const who = c.character ?? speaker ?? '';
  const color = content.characters[who]?.color ?? '#ff7eb6';
  // Exactly one sound per choice, picked by how it landed.
  if (c.attributes?.['sampling.priority'] === '1') {
    sfx('affection');
    return keptMoment(content.characters.traces?.color ?? color);
  }
  const delta = c.affection_delta ?? 0;
  const vibe = c.vibe ?? (delta > 0 ? 'good' : delta < 0 ? 'bad' : undefined);
  if (vibe === 'good') {
    sfx(who === 'metrics' ? 'counter' : 'affection');
    goodChoice(color);
  } else if (vibe === 'bad') {
    sfx('sampled');
    badChoice();
  } else sfx('choice');
}

/** Endings earn one celebration: hearts in the colours of the route. */
function burst(colors: string[]) {
  const host = Object.assign(document.createElement('div'), { className: 'burst' });
  host.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 26; i++) {
    const h = document.createElement('i');
    const set = (k: string, v: string) => h.style.setProperty(k, v);
    h.style.left = `${Math.random() * 100}%`;
    set('--c', colors[i % colors.length]);
    set('--s', `${14 + Math.random() * 22}px`);
    set('--x', `${(Math.random() - 0.5) * 30}vw`);
    set('--r', `${(Math.random() - 0.5) * 120}deg`);
    set('--d', `${2.2 + Math.random() * 1.6}s`);
    set('--delay', `${Math.random() * 0.6}s`);
    host.appendChild(h);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 4800);
}

// ---------- SQL overlay: the generated SQL behind each choice ----------
const overlayItems: { name: string; sql: string; result: string; ok: boolean }[] = [];
function trace(name: string, sql: string, result: string, ok = true) {
  overlayItems.unshift({ name, sql: sql.trim(), result, ok });
  overlayItems.length = Math.min(overlayItems.length, 12);
  $('#overlay-list').replaceChildren(
    ...overlayItems.map((i) => {
      const li = document.createElement('li');
      const title = Object.assign(document.createElement('strong'), { textContent: i.name });
      const res = Object.assign(document.createElement('span'), { className: `res ${i.ok ? '' : 'false'}`, textContent: ` → ${i.result}` });
      const pre = Object.assign(document.createElement('pre'), { textContent: i.sql });
      li.append(title, res, pre);
      return li;
    }),
  );
}
function setOverlay(on: boolean) {
  $('#overlay').hidden = !on;
  $('#btn-overlay').setAttribute('aria-pressed', String(on));
  pref.set('overlay', on ? '1' : '0');
}

// ---------- stage ----------
let shownBg = '';
/** Crossfade to a new background: a new layer fades in over the old one, which is then removed. */
function setBg(bg?: string) {
  if (!bg || bg === shownBg) return;
  shownBg = bg;
  const host = $('#bg');
  const layer = document.createElement('div');
  layer.className = 'layer';
  layer.style.backgroundImage = `url(${ART}/bgs/${bg}.webp)`;
  host.appendChild(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('on')));
  const old = [...host.querySelectorAll('.layer')].slice(0, -1);
  setTimeout(() => old.forEach((l) => l.remove()), 800);
}

let shownSprite = '';
function setPortrait(speaker: string, mood = 'neutral') {
  const def = content.characters[speaker];
  document.documentElement.style.setProperty('--accent', def?.color ?? '#b69cff');
  if (!def?.sprite) return; // icon-only speakers (the pager) keep the last portrait
  const key = `${def.sprite}_${mood}${def.silhouette ? '_s' : ''}`;
  if (key === shownSprite) return;
  shownSprite = key;
  const sprite = $<HTMLImageElement>('#sprite');
  const card = $('#card');
  // Same character, new expression: fade the old face out over the new one instead of a hard cut.
  const sameCharacter = !sprite.hidden && sprite.dataset.who === def.sprite && sprite.complete && sprite.naturalWidth > 0;
  if (sameCharacter) {
    const ghost = sprite.cloneNode() as HTMLImageElement;
    ghost.removeAttribute('id');
    ghost.className = `sprite-old ${sprite.className}`;
    sprite.parentElement!.appendChild(ghost);
    setTimeout(() => ghost.remove(), 260);
    sprite.style.animation = 'none';
  } else sprite.style.animation = '';
  sprite.dataset.who = def.sprite;
  sprite.classList.toggle('silhouette', !!def.silhouette);
  sprite.hidden = false;
  card.hidden = true;
  sprite.onerror = () => {
    // No art for this one: a bubbly placeholder card in the character's colour.
    sprite.hidden = true;
    card.hidden = false;
    card.textContent = def.silhouette ? '?' : def.name.replace(/^The /, '').charAt(0);
  };
  sprite.src = `${ART}/sprites/${def.sprite}_${mood}.webp`;
}
function clearPortrait() {
  shownSprite = '';
  $('#sprite').hidden = true;
  $('#card').hidden = true;
}
function setCg(cg?: string) {
  const img = $<HTMLImageElement>('#cg');
  img.hidden = !cg;
  if (cg) {
    img.onerror = () => (img.hidden = true);
    img.src = `${ART}/cgs/${cg}.webp`;
  }
}

// ---------- dialogue ----------
const SPEEDS: Record<string, number> = { slow: 28, normal: 55, fast: 110, instant: Infinity };
// Reduce motion: the OS setting, or the player's own choice in settings (which wins either way).
const motionPref = pref.get('reduceMotion');
const reducedMotion = motionPref ? motionPref === '1' : matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.toggle('reduce-motion', reducedMotion);
let autoFactor = Number(pref.get('autoSpeed') ?? 1);
let textSpeed = pref.get('textSpeed') ?? (reducedMotion ? 'instant' : 'normal');
let typing: { finish(): void } | undefined;

/** Show a line, typing it out with the speaker's babble. Resolves when the whole line is visible. */
function say(speaker: string, text: string, instant = false): Promise<void> {
  const name = $('#speaker');
  name.textContent = speaker ? content.characters[speaker]?.name ?? speaker : '';
  name.hidden = !speaker;
  const el = $('#text');
  el.classList.toggle('narration', !speaker);
  $('#choices').replaceChildren();
  $('#result').hidden = true;
  $('#sr-line').textContent = speaker ? `${name.textContent}: ${text}` : text; // screen readers get the whole line at once
  typing?.finish();
  const cps = SPEEDS[textSpeed] ?? SPEEDS.normal;
  if (instant || cps === Infinity) {
    el.textContent = text;
    return Promise.resolve();
  }
  el.textContent = '';
  return new Promise((resolve) => {
    let shown = 0;
    let raf = 0;
    const t0 = performance.now();
    const done = () => {
      cancelAnimationFrame(raf);
      el.textContent = text;
      typing = undefined;
      resolve();
    };
    const tick = () => {
      const target = Math.min(text.length, Math.floor(((performance.now() - t0) / 1000) * cps));
      for (; shown < target; shown++) babble(speaker, shown, text[shown]);
      el.textContent = text.slice(0, shown);
      if (shown < text.length) raf = requestAnimationFrame(tick);
      else done();
    };
    typing = { finish: done };
    raf = requestAnimationFrame(tick);
  });
}

function table(rows: Row[], max = 50): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  if (!rows.length) {
    wrap.textContent = '0 rows';
    return wrap;
  }
  const t = document.createElement('table');
  const cols = Object.keys(rows[0]);
  const head = t.createTHead().insertRow();
  for (const c of cols) head.appendChild(Object.assign(document.createElement('th'), { textContent: c }));
  const body = t.createTBody();
  for (const r of rows.slice(0, max)) {
    const tr = body.insertRow();
    for (const c of cols) {
      const v = r[c];
      tr.insertCell().textContent = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    }
  }
  wrap.appendChild(t);
  return wrap;
}

let autoMode = false;
let skipMode = false;
const seen = new Set<string>(JSON.parse(pref.get('seen') ?? '[]') as string[]);
function markSeen(key: string) {
  if (seen.has(key)) return;
  seen.add(key);
  pref.set('seen', JSON.stringify([...seen]));
}

/** Resolve on click / Enter / Space, or by itself in auto mode (reading time) or skip mode (seen lines). */
function advance(opts: { textLength?: number; seenLine?: boolean } = {}): Promise<void> {
  const box = $('#box');
  box.classList.add('waiting');
  box.focus({ preventScroll: true });
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      box.removeEventListener('click', done);
      box.removeEventListener('keydown', done);
      box.classList.remove('waiting');
      resolve();
    };
    const done = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      sfx('advance');
      finish();
    };
    box.addEventListener('click', done);
    box.addEventListener('keydown', done);
    if (skipMode && opts.seenLine) timer = setTimeout(finish, 80);
    else if (autoMode) timer = setTimeout(finish, (1200 + (opts.textLength ?? 0) * 45) * autoFactor);
  });
}

// A click or key on the box while a line is typing finishes the line instead of advancing.
function wireTypingSkip() {
  const box = $('#box');
  const finishTyping = (e: Event) => {
    if (!typing) return;
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    typing.finish();
  };
  box.addEventListener('click', finishTyping, true);
  box.addEventListener('keydown', finishTyping, true);
}

function pick(choices: { id: string; text: string; secret: boolean }[]): Promise<string> {
  return new Promise((resolve) => {
    const buttons = choices.map((c) => {
      const b = document.createElement('button');
      b.textContent = c.text;
      b.dataset.choice = c.id;
      if (c.secret) b.classList.add('secret');
      b.onclick = (e) => {
        e.stopPropagation();
        resolve(c.id);
      };
      return b;
    });
    $('#choices').replaceChildren(...buttons);
    buttons[0]?.focus({ preventScroll: true });
  });
}

// ---------- queries ----------
const cond: Conditions = async (name) => {
  const sql = queries[name];
  if (!sql) throw new Error(`unknown query ${name}`);
  const ok = truthy(await (await ready).query(sql, { session_id: log.sessionId }));
  trace(name, sql, String(ok), ok);
  return ok;
};

async function showQuery(name: string) {
  const sql = queries[name];
  const rows = await (await ready).query(sql, { session_id: log.sessionId });
  trace(name, sql, `${rows.length} rows`);
  const res = $('#result');
  res.replaceChildren(table(rows, 12));
  res.hidden = false;
}

// ---------- the story loop ----------
async function play(sceneId: string, startNode?: string, alreadyShown = false) {
  let scene: Scene = scenes[sceneId];
  let id: string | undefined = startNode ?? scene.start;
  if (!startNode) await log.append({ scene: scene.id, event_type: 'scene_enter', node: scene.start });
  setBg(scene.bg);
  playMusic(scene.music ?? 'none');
  let skipLog = alreadyShown;

  while (id) {
    const n: SceneNode = node(scene, id);
    current = { scene: scene.id, node: n.id };
    if (needsQueries(n) && boot.state !== 'ready') {
      say('', 'Waiting for the collector to finish indexing you…');
      await ready;
    }
    const lineKey = `${scene.id}/${n.id}`;
    const fill = (text: string) => render(text, { player, characters });

    if (n.bg) setBg(n.bg);
    if (n.music) playMusic(n.music);
    if (n.sfx) sfx(n.sfx);
    setCg(n.cg);
    if (n.action === 'create_character' && !player) {
      player = await createCharacter(characters);
      await log.append({ scene: scene.id, node: n.id, event_type: 'character_created', attributes: playerAttributes(player) });
    }
    if (n.action?.startsWith('open_console')) await shell(n.action.split(':')[1] as View | undefined);
    if (n.action === 'incident_start' || n.action === 'keep_trace' || n.action === 'resolve_incident') await incident(n.action, scene.id, n.id);

    let logged: Promise<unknown> = Promise.resolve();
    let typed: Promise<void> = Promise.resolve();
    let textLength = 0;
    const seenLine = seen.has(lineKey);
    if (n.text) {
      const text = fill(n.text);
      textLength = text.length;
      if (n.speaker) {
        setPortrait(n.speaker, n.mood);
        if (!(skipMode && seenLine)) moodChange(n.speaker, n.mood, content.characters[n.speaker]?.color ?? '#ff7eb6');
      } else document.documentElement.style.setProperty('--accent', '#b69cff');
      typed = say(n.speaker ?? '', text, skipMode && seenLine);
      // Don't await before listening for input, or fast clicks get dropped.
      if (!skipLog) logged = log.append({ scene: scene.id, node: n.id, event_type: 'line', character: n.speaker ?? '', dialogue_text: text });
      markSeen(lineKey);
    }
    skipLog = false;
    await typed;
    if (n.show) await showQuery(n.show);

    if (n.ending) {
      await advance({ textLength });
      await logged;
      await log.append({ scene: scene.id, node: n.id, event_type: 'ending', route: n.id, attributes: { 'ending.title': n.ending } });
      return endingScreen(n.ending, n.id);
    }

    const choices = (await visibleChoices(n, cond)).map((c) => ({ ...c, text: fill(c.text) }));
    let next: string | undefined;
    if (choices.length) {
      const shown = performance.now();
      // A conditional choice among ordinary ones is a secret the player unlocked.
      const mixed = choices.some((c) => !c.condition);
      const choice = await pick(choices.map((c) => ({ id: c.id, text: c.text, secret: mixed && !!c.condition })));
      await logged;
      const c = choices.find((x) => x.id === choice)!;
      react(c, n.speaker);
      flourish(c, n.speaker);
      await log.append({
        scene: scene.id, node: n.id, event_type: 'choice',
        character: c.character ?? n.speaker ?? '', choice_id: c.id, choice_text: c.text, dialogue_text: c.text,
        affection_delta: c.affection_delta ?? 0, time_to_choose_ms: Math.round(performance.now() - shown),
        attributes: c.attributes ?? {},
      });
      next = await nextNode(n, cond, c.id);
    } else {
      if (n.text) await advance({ textLength, seenLine });
      await logged;
      next = await nextNode(n, cond);
    }

    const other = next && sceneTarget(next);
    if (other) {
      scene = scenes[other];
      id = scene.start;
      clearPortrait();
      resetMood();
      setCg(undefined);
      setBg(scene.bg);
      playMusic(scene.music ?? 'none');
      await log.append({ scene: scene.id, event_type: 'scene_enter', node: scene.start });
    } else id = next;
  }
}

const ENDINGS = Object.values(scenes).flatMap((s: Scene) =>
  Object.values(s.nodes).filter((x: SceneNode) => x.ending).map((x: SceneNode) => ({ title: x.ending!, cg: x.cg })),
);
// Reached endings survive new sessions (a new session wipes the event log, not the gallery).
const reachedEndings = () => new Set<string>(JSON.parse(pref.get('endings') ?? '[]') as string[]);

// Endings without an illustration: who you didn't end up with, where it happened.
const CARD_ART: Record<string, { bg: string; sprites: string[] }> = {
  end_relapse: { bg: 'noc_room', sprites: ['monitoring_happy'] },
  end_retention: { bg: 'archive_cafe', sprites: ['logs_sad'] },
  end_rolled_up: { bg: 'dashboard_gym', sprites: ['metrics_sad'] },
  end_sampled_out: { bg: 'sampling_cafe', sprites: ['traces_sad'] },
  end_home: { bg: 'bedroom_night', sprites: [] },
};
let card: Blob | undefined;

/** Paint the share card from the ending and a stats row; the screen works without it. */
async function makeCard(title: string, nodeId: string, cg?: string) {
  const img = $<HTMLImageElement>('#share-card');
  img.hidden = true;
  card = undefined;
  try {
    const [row] = await (await ready).query(queries.share_stats);
    const lines = statLines(row ?? {});
    const art = CARD_ART[nodeId] ?? { bg: 'finale_sky', sprites: [] };
    card = await drawCard({
      title, lines, name: player?.name ?? 'Someone', site: location.host,
      art: { cg: cg && `${ART}/cgs/${cg}.webp`, bg: `${ART}/bgs/${art.bg}.webp`, sprites: art.sprites.map((s) => `${ART}/sprites/${s}.webp`) },
      colors: ['logs', 'traces', 'metrics', 'collector', 'dba'].map((k) => content.characters[k]?.color ?? '#ff7eb6'),
    });
    img.src = URL.createObjectURL(card);
    img.alt = `Share card: ${title}. ${lines.join('. ')}.`;
    img.hidden = false;
  } catch (e) {
    console.error('[share] no card', e);
  }
}

function endingScreen(title: string, nodeId: string) {
  const reached = reachedEndings();
  reached.add(title);
  pref.set('endings', JSON.stringify([...reached]));
  $('#game').hidden = true;
  $('#toolbar').hidden = true;
  $('#ending').hidden = false;
  $('#ending-title').textContent = title;
  $('#ending-count').textContent = `${reached.size} of ${ENDING_COUNT} endings found. Every new session is a fresh trace.`;
  $('#btn-share').onclick = () => share(title);
  $('#btn-again').focus();
  // Only the good endings celebrate (they're the ones with an illustration), in that route's colours.
  const cg = ENDINGS.find((e) => e.title === title)?.cg;
  void makeCard(title, nodeId, cg);
  const ROUTE: Record<string, string[]> = { polycule: ['logs', 'metrics', 'traces'], logs_end: ['logs'], metrics_end: ['metrics'], traces_end: ['traces'] };
  if (cg && ROUTE[cg]) burst(ROUTE[cg].map((k) => content.characters[k]?.color ?? '#ff7eb6'));
}

async function share(title: string) {
  const text = `I got the "${title}" ending in High Cardinality, a dating sim where ClickHouse decides who loves you.`;
  const url = location.origin;
  const file = card && new File([card], 'high-cardinality.png', { type: 'image/png' });
  try {
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'High Cardinality', text, url, files: [file] });
    else if (navigator.share) await navigator.share({ title: 'High Cardinality', text, url });
    else if (file) {
      // No share sheet (most desktops): save the card, and put the words on the clipboard.
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name }).click();
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('#share-note').textContent = 'Saved the card, and copied the text to your clipboard.';
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('#share-note').textContent = 'Copied to your clipboard.';
    }
  } catch {
    /* the player closed the share sheet */
  }
}

function showEndings() {
  const reached = reachedEndings();
  $('#endings-count').textContent = `${reached.size} of ${ENDING_COUNT} found`;
  $('#endings-list').replaceChildren(
    ...ENDINGS.map((e) => {
      const li = document.createElement('li');
      const got = reached.has(e.title);
      li.classList.toggle('locked', !got);
      const pic = got && e.cg ? Object.assign(document.createElement('img'), { src: `${ART}/cgs/${e.cg}.webp`, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('div'), { className: 'blank' });
      const label = Object.assign(document.createElement('span'), { textContent: got ? e.title : '???' });
      li.append(pic, label);
      return li;
    }),
  );
  $<HTMLDialogElement>('#endings').showModal();
}

// ---------- the backlog: literally the Logs view ----------
async function showBacklog() {
  type Line = { character: string; dialogue_text: string };
  let lines: Line[];
  if (boot.state === 'ready')
    lines = await (await ready).query<Line>("SELECT character, dialogue_text FROM logs WHERE dialogue_text != '' ORDER BY ts DESC LIMIT 200");
  else lines = (await log.all()).filter((e) => e.dialogue_text).reverse().slice(0, 200);
  const choiceTexts = new Set((await log.all()).filter((e) => e.event_type === 'choice').map((e) => e.dialogue_text));
  $('#backlog-list').replaceChildren(
    ...lines.map((l) => {
      const li = document.createElement('li');
      const def = l.character ? content.characters[l.character] : undefined;
      const mine = choiceTexts.has(l.dialogue_text);
      if (def && !mine) {
        const who = Object.assign(document.createElement('span'), { className: 'who', textContent: def.name });
        who.style.background = def.color ?? '#b69cff';
        li.appendChild(who);
      }
      li.appendChild(Object.assign(document.createElement('span'), { className: mine ? 'you' : '', textContent: mine ? `you: ${l.dialogue_text}` : l.dialogue_text }));
      return li;
    }),
  );
  $<HTMLDialogElement>('#backlog').showModal();
}

// ---------- the Query Shell ----------
const SHELL_HINTS: [string, string][] = [
  ['what tables are there?', 'SHOW TABLES'],
  ['what does Metrics know?', 'SELECT * FROM metrics_agg'],
  ['what did Traces see?', 'SELECT ts, scene, character, choice_text FROM traces ORDER BY ts'],
  ['what did Logs hear?', 'SELECT * FROM logs ORDER BY ts DESC LIMIT 20'],
  ['who do I talk to most?', "SELECT character, count() AS lines FROM logs WHERE character != '' GROUP BY character ORDER BY lines DESC"],
];

/** Every Query Shell query, typed or drawn by a view: the read-only connection, then logged as query_run. */
async function shellQuery(sql: string): Promise<{ rows?: Row[]; note?: string; error?: string }> {
  try {
    sfx('query');
    const r = await (await ready).console(sql);
    const base = r.tables.includes('default.events');
    trace('query shell', sql, `${r.rows.length} rows · ${r.tables.join(', ') || 'no tables'}`);
    await log.append({
      scene: current.scene, node: current.node, event_type: 'query_run',
      attributes: { 'query.text': sql.slice(0, 2000), 'query.tables': r.tables.join(','), 'query.base_table': String(base), 'query.rows': String(r.rows.length) },
    });
    return { rows: r.rows, note: `${r.rows.length} rows · ${Math.round(r.ms)} ms${base ? ' · that’s the whole of you ♥' : ''}` };
  } catch (e) {
    sfx('error');
    const message = String((e as Error).message ?? e).replace(/^Code: \d+\. DB::Exception: /, '').slice(0, 400);
    await log.append({ scene: current.scene, node: current.node, event_type: 'query_run', attributes: { 'query.text': sql.slice(0, 2000), 'query.error': message } });
    return { error: message };
  }
}

async function shell(view?: View) {
  const found = (await log.all()).some((e) => e.event_type === 'item_found' && e.attributes.item === 'query_shell');
  if (!found) await log.append({ scene: current.scene, node: current.node, event_type: 'item_found', attributes: { item: 'query_shell' } });
  $('#btn-shell').hidden = false;
  await ready;
  const cf = await refreshCase();
  // The wide-event lead: the DBA asks for a query you may never have typed, so offer it.
  const hints: [string, string][] = cf.current?.id === 'wide' ? [['errors by tier, distinct subscriber_ids', queries.root_cause.replace(/^--.*\n/gm, '')], ...SHELL_HINTS] : SHELL_HINTS;
  sfx('shell_open');
  await openConsole({ hints, table, run: shellQuery, characters: content.characters, view, caseFile: () => caseNow });
}

let caseNow: CaseFile = caseFile([]);
/** Re-read the case file from the log; the shell button wears SEV-1 while the incident is open. */
async function refreshCase() {
  caseNow = caseFile(await log.all());
  $('#btn-shell').classList.toggle('sev', caseNow.active);
  return caseNow;
}
hooks.openShell = (view?: View) => void shell(view); // for e2e

// ---------- the incident ----------
// The log holds only the markers; the Realm's telemetry is regenerated from them (restoreIncident on replay).
const MARKER = { incident_start: 'incident_started', keep_trace: 'trace_kept', resolve_incident: 'incident_resolved' } as const;
async function incident(action: keyof typeof MARKER, scene: string, node: string) {
  const events = await log.all();
  if (events.some((e) => e.event_type === MARKER[action])) return; // revisited: it already happened
  const db = await ready;
  const ev = await log.append({ scene, node, event_type: MARKER[action] });
  const started = events.find((e) => e.event_type === 'incident_started');
  if (action === 'incident_start') await db.insert('events', incidentRows(log.sessionId, ev.ts));
  if (action === 'keep_trace' && started) await db.insert('events', keptTraceRows(log.sessionId, started.ts));
  await refreshCase();
}
hooks.incident = incident; // for e2e

// ---------- saves ----------
async function exportSave() {
  const blob = new Blob([await log.exportJsonl()], { type: 'application/x-ndjson' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `high-cardinality-${new Date().toISOString().slice(0, 10)}.jsonl`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importSave(file: File | undefined, note: HTMLElement) {
  if (!file) return;
  try {
    await log.replace(parseSave(await file.text()));
    location.reload();
  } catch (e) {
    note.textContent = `Couldn't import that save: ${(e as Error).message}`;
  }
}

/** A fresh session needs a new session_id and an empty chDB, so wipe the log and reload into it. */
async function newSession() {
  try { sessionStorage.setItem('hc.autostart', '1'); } catch { /* the title screen will show instead */ }
  await log.replace([]);
  location.reload();
}

// ---------- boot ----------
async function start(events: GameEvent[]) {
  $('#title').hidden = true;
  $('#game').hidden = false;
  $('#toolbar').hidden = false;
  if (events.some((e) => e.event_type === 'item_found')) $('#btn-shell').hidden = false;
  await refreshCase();
  const resume = resumePoint(events, scenes);
  if (resume) await play(resume.scene, resume.node, resume.shown);
  else await play('prologue');
}

/** The title screen's explainer, with a live line from the engine running in this tab. */
async function showAbout() {
  const live = $('#about-live');
  $<HTMLDialogElement>('#about').showModal();
  if (boot.state !== 'ready') {
    live.textContent = `> the engine is still downloading. ${$('#loader').textContent ?? ''}`;
    return;
  }
  const db = await ready;
  const [r] = await db.query<{ v: string; n: string }>('SELECT version() AS v, (SELECT count() FROM events) AS n');
  live.textContent = `> SELECT version(), count() FROM events\n  ClickHouse ${r.v} · ${Number(r.n).toLocaleString()} events in your save`;
}

function wireChrome() {
  $('#import-title').onchange = (e) => importSave((e.target as HTMLInputElement).files?.[0], $('#title-note'));
  $('#import-menu').onchange = (e) => importSave((e.target as HTMLInputElement).files?.[0], $('#menu .note'));
  $('#btn-export').onclick = exportSave;
  $('#btn-export-end').onclick = exportSave;
  $('#btn-again').onclick = newSession;
  $('#btn-reset').onclick = () => ($('#reset-confirm').hidden = false);
  $('#btn-reset-yes').onclick = newSession;
  $('#btn-title').onclick = () => location.reload();
  $('#btn-about-title').onclick = () => void showAbout();
  $('#btn-endings-title').onclick = showEndings;
  $('#btn-backlog').onclick = () => void showBacklog();
  const toggle = (btn: string, on: boolean) => $(btn).setAttribute('aria-pressed', String(on));
  const setAuto = (on: boolean) => { autoMode = on; toggle('#btn-auto', on); };
  const setSkip = (on: boolean) => { skipMode = on; toggle('#btn-skip', on); };
  $('#btn-auto').onclick = () => setAuto(!autoMode);
  $('#btn-skip').onclick = () => setSkip(!skipMode);
  const openSettings = () => $<HTMLDialogElement>('#settings').showModal();
  $('#btn-settings-title').onclick = openSettings;
  $('#btn-settings-menu').onclick = () => { $<HTMLDialogElement>('#menu').close(); openSettings(); };
  const sound = $<HTMLInputElement>('#set-sound');
  sound.checked = !isMuted();
  sound.onchange = () => setMuted(!sound.checked);
  const auto = $<HTMLSelectElement>('#auto-speed');
  auto.value = String(autoFactor);
  auto.onchange = () => { autoFactor = Number(auto.value); pref.set('autoSpeed', auto.value); };
  const effects = $<HTMLInputElement>('#set-fx');
  effects.checked = pref.get('fx') !== '0';
  effects.onchange = () => pref.set('fx', effects.checked ? '1' : '0');
  const motion = $<HTMLInputElement>('#set-motion');
  motion.checked = reducedMotion;
  motion.onchange = () => {
    pref.set('reduceMotion', motion.checked ? '1' : '0');
    document.documentElement.classList.toggle('reduce-motion', motion.checked);
  };
  for (const c of ['music', 'sfx', 'voice'] as const) {
    const input = $<HTMLInputElement>(`#vol-${c}`);
    input.value = String(getVolume(c));
    input.oninput = () => setVolume(c, Number(input.value));
  }
  const speed = $<HTMLSelectElement>('#text-speed');
  speed.value = textSpeed;
  speed.onchange = () => { textSpeed = speed.value; pref.set('textSpeed', textSpeed); };
  wireTypingSkip();
  // Browsers only allow audio after a gesture: the first click or key anywhere starts it.
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, { capture: true });
  $('#btn-about-menu').onclick = () => void showAbout();
  $('#btn-menu').onclick = () => $<HTMLDialogElement>('#menu').showModal();
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog'))
    d.querySelector('.close')?.addEventListener('click', () => d.close());
  $('#btn-shell').onclick = () => void shell();
  $('#btn-overlay').onclick = () => setOverlay($('#overlay').hidden === true);
  const size = $<HTMLSelectElement>('#text-size');
  size.value = String(scale);
  size.onchange = () => { scale = Number(size.value); pref.set('scale', String(scale)); applyScale(); };
  setOverlay(pref.get('overlay') === '1');
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, dialog')) return;
    if (e.key === '`') setOverlay($('#overlay').hidden === true);
    if ((e.key === 'q' || e.key === 'Q') && !$('#btn-shell').hidden) void shell();
    // Open on the next tick: Chrome treats the same Escape press as "close the top modal".
    if (e.key === 'Escape' && !$('#toolbar').hidden) setTimeout(() => $<HTMLDialogElement>('#menu').showModal());
    if (!$('#toolbar').hidden) {
      if (e.key === 'l' || e.key === 'L') void showBacklog();
      if (e.key === 'a' || e.key === 'A') setAuto(!autoMode);
      if (e.key === 's' || e.key === 'S') setSkip(!skipMode);
    }
  });
}

/** Wrap each title letter for the drop-in; the heading keeps one readable label. */
function prepareTitle() {
  const h1 = document.querySelector<HTMLElement>('.logo h1');
  if (!h1 || h1.dataset.ready) return;
  h1.dataset.ready = '1';
  const words = [...h1.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim());
  h1.setAttribute('aria-label', words.filter(Boolean).join(' '));
  let i = 0;
  const wrap = (node: Node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const frag = document.createDocumentFragment();
    for (const ch of node.textContent ?? '') {
      const span = Object.assign(document.createElement('span'), { className: 'ch', textContent: ch });
      span.setAttribute('aria-hidden', 'true');
      span.style.setProperty('--i', String(i++));
      frag.appendChild(span);
    }
    node.parentNode!.replaceChild(frag, node);
  };
  [...h1.childNodes].forEach(wrap);
}

async function main() {
  applyScale();
  prepareTitle();
  const support = clientSupport();
  if (!support.ok) return unsupported(support.reason);

  log = await openLog();
  hooks.log = log;
  ready = openDb().then(async (db) => {
    boot.replayed = await log.attach(db);
    await restoreIncident(db, await log.all());
    boot.state = 'ready';
    $('#loader').textContent = boot.replayed ? `collector online · ${boot.replayed} events replayed` : 'collector online';
    $('#loader').classList.add('ok');
    setTimeout(() => $('#loader').classList.add('gone'), 3000);
    hooks.query = db.query;
    hooks.console = db.console;
    return db;
  });
  ready.catch((e) => {
    boot.state = 'failed';
    boot.error = String((e as Error).message ?? e);
    $('#loader').textContent = 'the collector crashed. Reload to try again.';
    $('#loader').classList.add('bad');
  });

  const events = await log.all();
  player = playerFromEvents(events);
  wireChrome();

  let auto = false;
  try {
    auto = sessionStorage.getItem('hc.autostart') === '1';
    sessionStorage.removeItem('hc.autostart');
  } catch { /* no session storage: show the title */ }
  if (auto && !events.length) return start([]);

  const resumable = !!resumePoint(events, scenes);
  $('#title').hidden = false;
  playMusic('title');
  $('#btn-continue').hidden = !resumable;
  if (events.some((e) => e.event_type === 'ending')) $('#title-note').textContent = 'You finished a playthrough. A new session starts the story over.';
  $('#btn-continue').onclick = () => start(events);
  $('#btn-new').onclick = () => (events.length ? newSession() : start([]));
  (resumable ? $('#btn-continue') : $('#btn-new')).focus();
}

// Offline play and install (production only: a dev server shouldn't be cached).
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

main().catch((e) => {
  boot.state = 'failed';
  boot.error = String((e as Error).message ?? e);
  console.error(e);
});
