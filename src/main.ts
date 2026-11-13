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
function setBg(bg?: string) {
  if (bg) $('#bg').style.backgroundImage = `url(${ART}/bgs/${bg}.webp), radial-gradient(circle at 30% 20%, #ffd6ec, transparent 55%), linear-gradient(#fff0f7, #e9e0ff)`;
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
function say(speaker: string, text: string) {
  const name = $('#speaker');
  name.textContent = speaker ? content.characters[speaker]?.name ?? speaker : '';
  name.hidden = !speaker;
  $('#text').textContent = text;
  $('#text').classList.toggle('narration', !speaker);
  $('#choices').replaceChildren();
  $('#result').hidden = true;
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

/** Resolve on click / Enter / Space on the dialogue box. */
function advance(): Promise<void> {
  const box = $('#box');
  box.classList.add('waiting');
  box.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const done = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      box.removeEventListener('click', done);
      box.removeEventListener('keydown', done);
      box.classList.remove('waiting');
      resolve();
    };
    box.addEventListener('click', done);
    box.addEventListener('keydown', done);
  });
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
    setCg(n.cg);
    if (n.action === 'create_character' && !player) {
      player = await createCharacter(characters);
      await log.append({ scene: scene.id, node: n.id, event_type: 'character_created', attributes: playerAttributes(player) });
    }
    if (n.action === 'open_console') await shell();

    let logged: Promise<unknown> = Promise.resolve();
    if (n.text) {
      const text = fill(n.text);
      if (n.speaker) setPortrait(n.speaker, n.mood);
      else document.documentElement.style.setProperty('--accent', '#b69cff');
      say(n.speaker ?? '', text);
      // Don't await before listening for input, or fast clicks get dropped.
      if (!skipLog) logged = log.append({ scene: scene.id, node: n.id, event_type: 'line', character: n.speaker ?? '', dialogue_text: text });
    }
    skipLog = false;
    if (n.show) await showQuery(n.show);

    if (n.ending) {
      await advance();
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
      await log.append({
        scene: scene.id, node: n.id, event_type: 'choice',
        character: c.character ?? n.speaker ?? '', choice_id: c.id, choice_text: c.text, dialogue_text: c.text,
        affection_delta: c.affection_delta ?? 0, time_to_choose_ms: Math.round(performance.now() - shown),
        attributes: c.attributes ?? {},
      });
      next = await nextNode(n, cond, c.id);
    } else {
      if (n.text) await advance();
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
      await log.append({ scene: scene.id, event_type: 'scene_enter', node: scene.start });
    } else id = next;
  }
}

function endingScreen(title: string) {
  $('#game').hidden = true;
  $('#ending').hidden = false;
  $('#ending-title').textContent = title;
  $('#ending-count').textContent = `One of ${ENDING_COUNT} endings. Every new session is a fresh trace.`;
  $('#btn-again').focus();
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
  await openConsole({
    hints: SHELL_HINTS,
    table,
    run: async (sql) => {
      try {
        const r = await db.console(sql);
        const base = r.tables.includes('default.events');
        trace('query shell', sql, `${r.rows.length} rows · ${r.tables.join(', ') || 'no tables'}`);
        await log.append({
          scene: current.scene, node: current.node, event_type: 'query_run',
          attributes: { 'query.text': sql.slice(0, 2000), 'query.tables': r.tables.join(','), 'query.base_table': String(base), 'query.rows': String(r.rows.length) },
        });
        return { rows: r.rows, note: `${r.rows.length} rows · ${Math.round(r.ms)} ms${base ? ' · that’s the whole of you ♥' : ''}` };
      } catch (e) {
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

function wireChrome() {
  $('#import-title').onchange = (e) => importSave((e.target as HTMLInputElement).files?.[0], $('#title-note'));
  $('#import-menu').onchange = (e) => importSave((e.target as HTMLInputElement).files?.[0], $('#menu .note'));
  $('#btn-export').onclick = exportSave;
  $('#btn-export-end').onclick = exportSave;
  $('#btn-again').onclick = newSession;
  $('#btn-reset').onclick = () => ($('#reset-confirm').hidden = false);
  $('#btn-reset-yes').onclick = newSession;
  $('#btn-title').onclick = () => location.reload();
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
