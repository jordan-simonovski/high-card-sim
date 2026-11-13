// Content validator, run at build time. Pure TS: no DOM, no chDB, no fs.
import { sceneTarget, type Scene, type SceneNode } from './scene.ts';
import { TOKEN, formOf } from './pronouns.ts';

export interface CharacterDef {
  name: string;
  pronouns: string; // preset key
  color?: string;
  sprite?: string;
  silhouette?: boolean;
}

export interface Content {
  scenes: Scene[];
  queries: string[];
  characters: Record<string, CharacterDef>;
  presets: string[];
  assets?: { moods: string[]; backgrounds: string[]; cgs: string[]; music?: string[]; sfx?: string[] };
}

export const ACTIONS = ['create_character', 'open_console'] as const;
export const FIRST_SCENE = 'prologue';

// Hardcoded gendered pronouns are banned in content text: NPC pronouns live in one registry
// and are referenced by token, and the player is only ever "you" or {name}.
const HARDCODED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
// "{logs.she}'s" can't agree for every NPC set; write "{logs.she} [logs:is|are]".
const CONTRACTION = /\{[A-Za-z_]+\.(?:they|them|their|she|he)\}['’](?:re|ve|s)\b/i;

function textsOf(n: SceneNode): string[] {
  return [n.text, ...(n.choices ?? []).map((c) => c.text)].filter((t) => typeof t === 'string');
}

/** Problems with a single content string. `usesPlayer` reports whether it needs the player ({name}). */
export function checkText(text: string, characters: Record<string, CharacterDef>): { errors: string[]; usesPlayer: boolean } {
  const errors: string[] = [];
  let usesPlayer = false;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, a, b, who, sing] = m;
    if (sing !== undefined) {
      if (!who) errors.push(`${whole}: verb agreement needs a character, like [logs:is|are] (the player is always "you")`);
      else if (!characters[who]) errors.push(`unknown character in ${whole}`);
    } else if (b !== undefined) {
      if (!characters[a]) errors.push(`unknown character in ${whole}`);
      if (!formOf(b)) errors.push(`unknown pronoun form in ${whole}`);
    } else if (a === 'name') usesPlayer = true;
    else errors.push(`unknown token ${whole} (the player has no pronouns: say "you" or use {name})`);
  }
  const bare = text.replace(TOKEN, ' ');
  const hard = bare.match(HARDCODED);
  if (hard) errors.push(`hardcoded pronoun "${hard[0]}": use an NPC token like {logs.she}, or "you" for the player`);
  if (CONTRACTION.test(text)) errors.push(`pronoun token with a contraction: write "{logs.she} [logs:is|are]" instead`);
  return { errors, usesPlayer };
}

export function validate(c: Content): string[] {
  const errors: string[] = [];
  const queries = new Set(c.queries);
  const ids = new Set<string>();
  const sceneIds = new Set(c.scenes.map((s) => s.id));
  const sceneEdges = new Map<string, string[]>();

  for (const s of c.scenes) {
    const at = (node: string, msg: string) => errors.push(`${s.id}/${node}: ${msg}`);
    if (ids.has(s.id)) errors.push(`duplicate scene id ${s.id}`);
    ids.add(s.id);
    if (!s.nodes[s.start]) errors.push(`${s.id}: start node "${s.start}" does not exist`);
    if (s.bg && c.assets && !c.assets.backgrounds.includes(s.bg)) errors.push(`${s.id}: unknown bg "${s.bg}"`);
    if (s.music && s.music !== 'none' && c.assets && !c.assets.music?.includes(s.music)) errors.push(`${s.id}: unknown music "${s.music}"`);

    const allTargets = (n: SceneNode) => [n.next, ...(n.branches ?? []).map((b) => b.target), ...(n.choices ?? []).map((c) => c.target)].filter((t): t is string => !!t);
    const targets = (n: SceneNode) => allTargets(n).filter((t) => !sceneTarget(t));
    sceneEdges.set(s.id, Object.values(s.nodes).flatMap((n) => allTargets(n).map(sceneTarget).filter((t): t is string => !!t)));
    const usesPlayer = new Set<string>();

    for (const [key, n] of Object.entries(s.nodes)) {
      if (typeof n.text !== 'string') at(key, 'text must be a string ("" for silent nodes)');
      if (n.speaker && !c.characters[n.speaker]) at(key, `unknown speaker "${n.speaker}"`);
      if (n.action && !(ACTIONS as readonly string[]).includes(n.action)) at(key, `unknown action "${n.action}"`);
      if (n.choices?.length && (n.next || n.branches?.length)) at(key, 'a node with choices cannot also have next/branches');
      const choiceIds = new Set<string>();
      for (const ch of n.choices ?? []) {
        if (!ch.id) at(key, 'choice without an id');
        if (choiceIds.has(ch.id)) at(key, `duplicate choice id "${ch.id}"`);
        choiceIds.add(ch.id);
        if (!ch.target) at(key, `choice "${ch.id}" has no target`);
        if (!ch.text?.trim()) at(key, `choice "${ch.id}" has no text`);
        if (ch.vibe !== undefined && ch.vibe !== 'good' && ch.vibe !== 'bad') at(key, `choice "${ch.id}": vibe must be good or bad`);
      }
      for (const q of [...(n.branches ?? []).map((b) => b.condition), ...(n.choices ?? []).map((ch) => ch.condition)])
        if (q && !queries.has(q)) at(key, `unknown query "${q}" (no content/queries/${q}.sql)`);
      for (const t of allTargets(n)) {
        const other = sceneTarget(t);
        if (other ? !sceneIds.has(other) : !s.nodes[t]) at(key, other ? `scene "${other}" does not exist` : `target "${t}" does not exist`);
      }
      if (c.assets) {
        if (n.mood && !c.assets.moods.includes(n.mood)) at(key, `unknown mood "${n.mood}"`);
        if (n.mood && !n.speaker) at(key, 'mood without a speaker');
        if (n.bg && !c.assets.backgrounds.includes(n.bg)) at(key, `unknown bg "${n.bg}"`);
        if (n.cg && !c.assets.cgs.includes(n.cg)) at(key, `unknown cg "${n.cg}"`);
        if (n.music && n.music !== 'none' && !c.assets.music?.includes(n.music)) at(key, `unknown music "${n.music}"`);
        if (n.sfx && !c.assets.sfx?.includes(n.sfx)) at(key, `unknown sfx "${n.sfx}"`);
      }
      if (n.show && !queries.has(n.show)) at(key, `unknown query "${n.show}" in show`);
      if (n.ending !== undefined && (allTargets(n).length || !n.ending.trim())) at(key, 'an ending needs a title and no next/branches/choices');
      if (n.ending === undefined && !allTargets(n).length) at(key, 'dead end: add next, choices, a scene jump (@scene) or an ending');
      for (const ch of n.choices ?? [])
        for (const [k, v] of Object.entries(ch.attributes ?? {}))
          if (!/^[a-z][a-z0-9_.]*$/.test(k) || typeof v !== 'string') at(key, `choice "${ch.id}": attribute ${k} must be a dotted.lowercase key with a string value`);
      for (const text of textsOf(n)) {
        const r = checkText(text, c.characters);
        for (const e of r.errors) at(key, e);
        if (r.usesPlayer) usesPlayer.add(key);
      }
    }

    // Reachability from start; and, in a scene that creates the character, no player
    // tokens on any path that hasn't been through creation yet.
    const walk = (stopAtCreate: boolean) => {
      const seen = new Set<string>();
      const stack = [s.start];
      while (stack.length) {
        const id = stack.pop()!;
        const n = s.nodes[id];
        if (!n || seen.has(id)) continue;
        seen.add(id);
        if (!(stopAtCreate && n.action === 'create_character')) stack.push(...targets(n));
      }
      return seen;
    };
    const reachable = walk(false);
    for (const key of Object.keys(s.nodes)) if (!reachable.has(key)) at(key, 'unreachable from start');
    if (Object.values(s.nodes).some((n) => n.action === 'create_character'))
      for (const key of walk(true))
        if (usesPlayer.has(key) && s.nodes[key].action !== 'create_character') at(key, 'uses player tokens before character creation');
  }

  if (sceneIds.size && !sceneIds.has(FIRST_SCENE)) errors.push(`missing first scene "${FIRST_SCENE}"`);
  const reached = new Set<string>();
  const todo = [FIRST_SCENE];
  while (todo.length) {
    const id = todo.pop()!;
    if (reached.has(id) || !sceneIds.has(id)) continue;
    reached.add(id);
    todo.push(...(sceneEdges.get(id) ?? []));
  }
  for (const id of sceneIds) if (!reached.has(id)) errors.push(`${id}: scene is unreachable from ${FIRST_SCENE}`);

  for (const [id, ch] of Object.entries(c.characters)) {
    if (!c.presets.includes(ch.pronouns)) errors.push(`characters/${id}: unknown pronoun preset "${ch.pronouns}"`);
    if (!ch.name) errors.push(`characters/${id}: missing name`);
  }
  for (const q of c.queries) if (!/^[a-z0-9_]+$/.test(q)) errors.push(`queries/${q}.sql: name must be snake_case`);
  return errors;
}
