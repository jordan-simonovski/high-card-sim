// Content never hardcodes pronouns. The player is always addressed as "you" (or by {name});
// they have no pronouns in the game at all. NPCs have theirs in content/characters.yaml, and
// content refers to them with tokens:
//   {name}                 the player's free-text name
//   {logs.she} {logs.She}  an NPC's forms; any form name works as the key ({x.They} capitalises)
//   [logs:is|are]          NPC verb agreement: singular|plural by that NPC's set
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
}

export interface RenderContext {
  player?: Player;
  characters: Record<string, PronounSet>;
}

/** Matches {name}, {x.form} and [x:singular|plural] (and, so the validator can flag them, bare {word} and [a|b]). */
export const TOKEN = /\{([A-Za-z_]+)(?:\.([A-Za-z]+))?\}|\[(?:([a-z_]+):)?([^|\]]+)\|([^\]]+)\]/g;

const cap = (s: string, like: string) => (like[0] === like[0].toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function formOf(word: string): Form | undefined {
  return FORM_ALIASES[word.toLowerCase()];
}

/** Render a content string. Throws on unknown tokens (the content validator catches these at build). */
export function render(text: string, ctx: RenderContext): string {
  const npc = (id: string) => {
    const s = ctx.characters[id];
    if (!s) throw new Error(`unknown character in token: ${id}`);
    return s;
  };
  return text.replace(TOKEN, (whole, a: string, b: string, who: string, sing: string, plur: string) => {
    if (sing !== undefined) {
      if (!who) throw new Error(`verb agreement needs a character: ${whole} (the player is always "you")`);
      return npc(who).plural ? plur : sing;
    }
    if (b !== undefined) {
      const form = formOf(b);
      if (!form) throw new Error(`unknown pronoun form: ${b}`);
      return cap(npc(a)[form], b);
    }
    if (a !== 'name') throw new Error(`unknown token ${whole} (the player has no pronouns: say "you" or use {name})`);
    if (!ctx.player) throw new Error(`{name} before character creation: ${text}`);
    return ctx.player.name;
  });
}
