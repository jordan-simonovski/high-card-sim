// Boot: support check -> title screen (engine downloads behind it) -> story. The prologue
// needs no queries, so the engine keeps loading while it plays. The event log is the save.
import './style.css';
import { clientSupport, openDb, truthy, type BootProgress, type Db, type Row, type Unsupported } from './db.ts';
import { openLog, type EventLog, type GameEvent } from './eventlog.ts';
import { needsQueries, nextNode, node, sceneTarget, visibleChoices, type Conditions, type Scene, type SceneNode } from './engine/scene.ts';
import { PRESETS, render, type Player, type Preset } from './engine/pronouns.ts';
import { resumePoint } from './engine/resume.ts';
import { createCharacter, playerAttributes, playerFromEvents } from './create.ts';
import { parseSave } from './saves.ts';
import { openConsole } from './console.ts';
import { babble, getVolume, playMusic, setVolume, sfx, unlock } from './audio.ts';
import content from 'virtual:content';

const { scenes, queries } = content;
const characters = Object.fromEntries(Object.entries(content.characters).map(([id, c]) => [id, PRESETS[c.pronouns as Preset]]));
const ENDING_COUNT = Object.values(scenes).reduce((n: number, s: Scene) => n + Object.values(s.nodes).filter((x: SceneNode) => x.ending).length, 0);
const ART = '/art';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const boot = { state: 'starting' as string, replayed: 0, error: '' };
const hooks = { boot } as Record<string, unknown>;
(window as unknown as { __hc: typeof hooks }).__hc = hooks;

let player: Player | undefined;
let log: EventLog;
let ready: Promise<Db>;
let current = { scene: 'prologue', node: '' };

// ---------- settings (per-viewer conveniences, so localStorage is fine) ----------
const pref = {
  get: (k: string) => { try { return localStorage.getItem(`hc.${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`hc.${k}`, v); } catch { /* private mode */ } },
};
const SCALES = [0.9, 1, 1.15, 1.3, 1.5];
let scale = Number(pref.get('scale') ?? 1);
const applyScale = () => document.documentElement.style.setProperty('--scale', String(scale));
const stepScale = (d: number) => {
  scale = SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale) + d))] ?? 1;
  pref.set('scale', String(scale));
  applyScale();
};

// ---------- unsupported ----------
const WHY: Record<Unsupported, string> = {
  memory64:
    "Your browser can't speak WebAssembly Memory64 yet (Safari and iOS, we're looking at you). The pillars live in Chrome and Edge for now.",
  firefox:
    "Firefox keeps dropping the collector mid-handshake, so the pillars can't meet you here yet. Try Chrome or Edge while we fix it.",
  isolation:
    'This page lost its cross-origin isolation, so the collector cannot spin up. Try opening the game directly instead of embedded.',
};

function unsupported(reason: Unsupported) {
  boot.state = 'unsupported';
  $('#loader').hidden = true;
  $('#unsupported').hidden = false;
  $('#unsupported .why').textContent = WHY[reason];
}

function showLoader(p: BootProgress) {
  const pct = Math.min(99, Math.floor((p.loaded / p.total) * 100));
  $('#loader').textContent = `spinning up the collector… ${pct}%`;
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
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    else if (autoMode) timer = setTimeout(finish, 1200 + (opts.textLength ?? 0) * 45);
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
        sfx('choice');
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
    const fill = (text: string) => render(text, { player, characters, lineKey });

    if (n.bg) setBg(n.bg);
    if (n.music) playMusic(n.music);
    if (n.sfx) sfx(n.sfx);
    setCg(n.cg);
    if (n.action === 'create_character' && !player) {
      player = await createCharacter(characters);
      await log.append({ scene: scene.id, node: n.id, event_type: 'character_created', attributes: playerAttributes(player) });
    }
    if (n.action === 'open_console') await shell();

    let logged: Promise<unknown> = Promise.resolve();
    let typed: Promise<void> = Promise.resolve();
    let textLength = 0;
    const seenLine = seen.has(lineKey);
    if (n.text) {
      const text = fill(n.text);
      textLength = text.length;
      if (n.speaker) setPortrait(n.speaker, n.mood);
      else document.documentElement.style.setProperty('--accent', '#b69cff');
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
      return endingScreen(n.ending);
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
      if ((c.affection_delta ?? 0) > 0 || c.attributes?.['sampling.priority'] === '1') sfx('affection');
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

function endingScreen(title: string) {
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
}

async function share(title: string) {
  const text = `I got the "${title}" ending in High Cardinality, a dating sim where ClickHouse decides who loves you.`;
  const url = location.origin;
  try {
    if (navigator.share) await navigator.share({ title: 'High Cardinality', text, url });
    else {
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

async function shell() {
  const found = (await log.all()).some((e) => e.event_type === 'item_found' && e.attributes.item === 'query_shell');
  if (!found) await log.append({ scene: current.scene, node: current.node, event_type: 'item_found', attributes: { item: 'query_shell' } });
  $('#btn-shell').hidden = false;
  const db = await ready;
  sfx('shell_open');
  await openConsole({
    hints: SHELL_HINTS,
    table,
    run: async (sql) => {
      try {
        sfx('query');
        const r = await db.console(sql);
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
    },
  });
}

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
  $('#btn-smaller').onclick = () => stepScale(-1);
  $('#btn-bigger').onclick = () => stepScale(1);
  setOverlay(pref.get('overlay') === '1');
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, dialog')) return;
    if (e.key === '`') setOverlay($('#overlay').hidden === true);
    if ((e.key === 'q' || e.key === 'Q') && !$('#btn-shell').hidden) void shell();
    if (e.key === 'Escape' && !$('#toolbar').hidden) $<HTMLDialogElement>('#menu').showModal();
    if (!$('#toolbar').hidden) {
      if (e.key === 'l' || e.key === 'L') void showBacklog();
      if (e.key === 'a' || e.key === 'A') setAuto(!autoMode);
      if (e.key === 's' || e.key === 'S') setSkip(!skipMode);
    }
  });
}

async function main() {
  applyScale();
  const support = clientSupport();
  if (!support.ok) return unsupported(support.reason);

  log = await openLog();
  hooks.log = log;
  ready = openDb(showLoader).then(async (db) => {
    boot.replayed = await log.attach(db);
    boot.state = 'ready';
    $('#loader').textContent = 'collector online';
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

main().catch((e) => {
  boot.state = 'failed';
  boot.error = String((e as Error).message ?? e);
  console.error(e);
});
