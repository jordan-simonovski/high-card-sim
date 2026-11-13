// Boot: support check -> prologue immediately -> engine loads in the background ->
// replay the event log -> query-gated nodes unblock.
import { clientSupport, openDb, truthy, type BootProgress, type Db, type Unsupported } from './db.ts';
import { openLog, type EventLog } from './eventlog.ts';
import { needsQueries, nextNode, node, visibleChoices, type Conditions, type Scene } from './engine/scene.ts';
import { PRESETS, render, type Player, type Preset } from './engine/pronouns.ts';
import { createCharacter, playerAttributes, playerFromEvents } from './create.ts';
import content from 'virtual:content';

const { scenes, queries } = content;
const characters = Object.fromEntries(Object.entries(content.characters).map(([id, c]) => [id, PRESETS[c.pronouns as Preset]]));
const displayName = (id?: string) => (id ? content.characters[id]?.name ?? id : '');
let player: Player | undefined;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const boot = { state: 'starting' as string, replayed: 0, error: '' };
const hooks = { boot } as Record<string, unknown>;
(window as unknown as { __hc: typeof hooks }).__hc = hooks;

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
  $('#game').hidden = true;
  const el = $('#unsupported');
  el.hidden = false;
  el.querySelector('.why')!.textContent = WHY[reason];
}

function showLoader(p: BootProgress) {
  const pct = Math.min(99, Math.floor((p.loaded / p.total) * 100));
  $('#loader').textContent = `spinning up the collector… ${pct}%`;
}

async function main() {
  const support = clientSupport();
  if (!support.ok) return unsupported(support.reason);

  const log = await openLog();
  const ready: Promise<Db> = openDb(showLoader).then(async (db) => {
    boot.replayed = await log.attach(db);
    boot.state = 'ready';
    $('#loader').textContent = 'collector online';
    $('#loader').classList.add('ok');
    hooks.query = db.query;
    return db;
  });
  ready.catch((e) => {
    boot.state = 'failed';
    boot.error = String((e as Error).message ?? e);
    $('#loader').textContent = 'the collector crashed. Reload to try again.';
    $('#loader').classList.add('bad');
  });
  hooks.log = log;
  player = playerFromEvents(await log.all());

  const cond: Conditions = async (name) => {
    const sql = queries[name];
    if (!sql) throw new Error(`unknown query ${name}`);
    return truthy(await (await ready).query(sql, { session_id: log.sessionId }));
  };
  await play(scenes.prologue, log, cond, ready);
}

async function play(scene: Scene, log: EventLog, cond: Conditions, ready: Promise<unknown>) {
  await log.append({ scene: scene.id, event_type: 'scene_enter', node: scene.start });
  let id: string | undefined = scene.start;
  while (id) {
    const n = node(scene, id);
    if (needsQueries(n) && boot.state !== 'ready') {
      say('', 'Waiting for the collector to finish indexing you…');
      await ready;
    }
    const lineKey = `${scene.id}/${n.id}`;
    const fill = (text: string) => render(text, { player, characters, lineKey });
    if (n.action === 'create_character' && !player) {
      player = await createCharacter(characters);
      await log.append({ scene: scene.id, node: n.id, event_type: 'character_created', attributes: playerAttributes(player) });
    }
    let logged: Promise<unknown> = Promise.resolve();
    if (n.text) {
      const text = fill(n.text);
      say(displayName(n.speaker), text);
      // Don't await before listening for input, or fast clicks get dropped.
      logged = log.append({ scene: scene.id, node: n.id, event_type: 'line', character: n.speaker ?? '', dialogue_text: text });
    }
    const choices = (await visibleChoices(n, cond)).map((c) => ({ ...c, text: fill(c.text) }));
    if (choices.length) {
      const shown = performance.now();
      const choice = await pick(choices.map((c) => ({ id: c.id, text: c.text })));
      await logged;
      const c = choices.find((x) => x.id === choice)!;
      await log.append({
        scene: scene.id, node: n.id, event_type: 'choice',
        character: c.character ?? n.speaker ?? '', choice_id: c.id, choice_text: c.text,
        affection_delta: c.affection_delta ?? 0, time_to_choose_ms: Math.round(performance.now() - shown),
      });
      id = await nextNode(n, cond, c.id);
    } else {
      if (n.text) await advance();
      await logged;
      id = await nextNode(n, cond);
    }
  }
  say('', 'End of the M2 build. Your playthrough is safe in the event log.');
  $('#game').dataset.ended = 'true';
}

function say(speaker: string, text: string) {
  const name = $('#speaker');
  name.textContent = speaker;
  name.hidden = !speaker;
  $('#text').textContent = text;
  $('#choices').replaceChildren();
}

/** Resolve on click / Enter / Space on the dialogue box. */
function advance(): Promise<void> {
  const box = $('#box');
  box.classList.add('waiting');
  box.focus();
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

function pick(choices: { id: string; text: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const buttons = choices.map((c) => {
      const b = document.createElement('button');
      b.textContent = c.text;
      b.dataset.choice = c.id;
      b.onclick = () => resolve(c.id);
      return b;
    });
    $('#choices').replaceChildren(...buttons);
    buttons[0]?.focus();
  });
}

main().catch((e) => {
  boot.state = 'failed';
  boot.error = String((e as Error).message ?? e);
  console.error(e);
});
