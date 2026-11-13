// Pronouns are span attributes. Content never hardcodes them; it uses tokens:
//   {name} {gender}                 the player's free-text attributes
//   {they} {them} {their} {theirs} {themself}   player pronoun forms ({They} capitalises)
//   [is|are]                        verb agreement: singular|plural, by the player's set
//   {logs.she} / {logs.They}        an NPC's forms; any form name works as the key
//   [logs:is|are]                   NPC verb agreement
// Pure TS: no DOM, no chDB.

export interface PronounSet {
  they: string;
  them: string;
  their: string;
  theirs: string;
  themself: string;
  /** Takes plural verb agreement ("they are"). */
  plural: boolean;
}

export const FORMS = ['they', 'them', 'their', 'theirs', 'themself'] as const;
export type Form = (typeof FORMS)[number];

export const PRESETS = {
  she: { they: 'she', them: 'her', their: 'her', theirs: 'hers', themself: 'herself', plural: false },
  he: { they: 'he', them: 'him', their: 'his', theirs: 'his', themself: 'himself', plural: false },
  they: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', themself: 'themself', plural: true },
  xe: { they: 'xe', them: 'xem', their: 'xyr', theirs: 'xyrs', themself: 'xemself', plural: false },
  ze: { they: 'ze', them: 'hir', their: 'hir', theirs: 'hirs', themself: 'hirself', plural: false },
  it: { they: 'it', them: 'it', their: 'its', theirs: 'its', themself: 'itself', plural: false },
} satisfies Record<string, PronounSet>;
export type Preset = keyof typeof PRESETS;

/** Any English form name maps to its slot, so writers can use {logs.she} or {logs.her}. */
const FORM_ALIASES: Record<string, Form> = {
  they: 'they', she: 'they', he: 'they', xe: 'they', ze: 'they',
  them: 'them', him: 'them', xem: 'them', hir: 'them',
  their: 'their', his: 'their', xyr: 'their',
  theirs: 'theirs', hers: 'theirs', xyrs: 'theirs', hirs: 'theirs',
  themself: 'themself', themselves: 'themself', herself: 'themself', himself: 'themself', xemself: 'themself', hirself: 'themself',
};
// 'her' is object or possessive; writers using {x.her} get the object form. Use {x.their} for possessive.
FORM_ALIASES.her = 'them';

export interface Player {
  name: string;
  gender: string;
  /** One or more sets (e.g. she + they). An empty list means "just use my name". */
  pronouns: PronounSet[];
}

export interface RenderContext {
  player?: Player;
  characters: Record<string, PronounSet>;
  /** Stable per line (e.g. scene/node), so multi-set players get a consistent set within a line. */
  lineKey: string;
}

/** Player's set for a line: deterministic rotation when they use several. */
export function setFor(player: Player, lineKey: string): PronounSet {
  if (!player.pronouns.length) {
    const n = player.name;
    return { they: n, them: n, their: `${n}’s`, theirs: `${n}’s`, themself: n, plural: false };
  }
  let h = 0;
  for (const c of lineKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return player.pronouns[h % player.pronouns.length];
}

export const TOKEN = /\{([A-Za-z_]+)(?:\.([A-Za-z]+))?\}|\[(?:([a-z_]+):)?([^|\]]+)\|([^\]]+)\]/g;

const cap = (s: string, like: string) => (like[0] === like[0].toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function formOf(word: string): Form | undefined {
  return FORM_ALIASES[word.toLowerCase()];
}

/** Render a content string. Throws on unknown tokens (the content validator catches these at build). */
export function render(text: string, ctx: RenderContext): string {
  const playerSet = () => {
    if (!ctx.player) throw new Error(`player token before character creation: ${text}`);
    return setFor(ctx.player, ctx.lineKey);
  };
  const npc = (id: string) => {
    const s = ctx.characters[id];
    if (!s) throw new Error(`unknown character in token: ${id}`);
    return s;
  };
  return text.replace(TOKEN, (_m, a: string, b: string, who: string, sing: string, plur: string) => {
    if (sing !== undefined) return (who ? npc(who) : playerSet()).plural ? plur : sing;
    if (b !== undefined) {
      const form = formOf(b);
      if (!form) throw new Error(`unknown pronoun form: ${b}`);
      return cap(npc(a)[form], b);
    }
    const set = playerSet(); // also enforces "after character creation"
    if (a === 'name') return ctx.player!.name;
    if (a === 'gender') return ctx.player!.gender;
    const form = a.toLowerCase() as Form;
    if (!FORMS.includes(form)) throw new Error(`unknown token {${a}} (player forms are {they} {them} {their} {theirs} {themself})`);
    return cap(set[form], a);
  });
}

/** "she/they"-style label for display and analytics. */
export function pronounLabel(p: Player): string {
  return p.pronouns.length ? p.pronouns.map((s) => s.they).join('/') : 'name only';
}
