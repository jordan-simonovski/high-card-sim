// Character creation: free-text name and gender, any pronoun sets (or name only, or custom).
// The player is stored as span attributes on a `character_created` event.
import { PRESETS, pronounLabel, render, type Player, type PronounSet, type Preset } from './engine/pronouns.ts';
import type { GameEvent } from './eventlog.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const PREVIEW = 'Logs: “Have you met {name}? {They} [is|are] new. I already love {them}. Is that {their} pager? {They} can page {themself}!”';

export function playerAttributes(p: Player): Record<string, string> {
  return {
    'player.name': p.name,
    'player.gender': p.gender,
    'player.pronouns': pronounLabel(p),
    'player.pronoun_sets': JSON.stringify(p.pronouns),
  };
}

/** Latest character from the event log (the log is the save file). */
export function playerFromEvents(events: GameEvent[]): Player | undefined {
  const e = events.findLast((x) => x.event_type === 'character_created');
  if (!e) return undefined;
  return {
    name: e.attributes['player.name'],
    gender: e.attributes['player.gender'] ?? '',
    pronouns: JSON.parse(e.attributes['player.pronoun_sets'] ?? '[]') as PronounSet[],
  };
}

/** `order` is the click order of pronoun chips: "she/they" and "they/she" are different people. */
function readForm(form: HTMLFormElement, order: string[]): { player?: Player; error?: string } {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const gender = String(data.get('gender') ?? '').trim();
  const picked = data.getAll('pronouns').map(String).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!name) return { error: 'player.name is required (it can be anything).' };
  if (!picked.length) return { error: 'Pick at least one pronoun set, a custom set, or "just my name".' };
  if (picked.includes('name')) return { player: { name, gender, pronouns: [] } };

  const pronouns: PronounSet[] = picked.filter((p) => p !== 'custom').map((p) => PRESETS[p as Preset]);
  if (picked.includes('custom')) {
    const f = (k: string) => String(data.get(`c_${k}`) ?? '').trim();
    const custom = { they: f('they'), them: f('them'), their: f('their'), theirs: f('theirs'), themself: f('themself'), plural: data.get('c_plural') === 'on' };
    if (!custom.they || !custom.them || !custom.their || !custom.theirs || !custom.themself)
      return { error: 'Fill in all five custom forms.' };
    pronouns.push(custom);
  }
  return { player: { name, gender, pronouns } };
}

export function createCharacter(characters: Record<string, PronounSet>): Promise<Player> {
  const form = $<HTMLFormElement>('#create');
  const preview = $('#preview');
  const error = $('#create-error');
  const custom = $<HTMLFieldSetElement>('#custom');
  $('#box').hidden = true;
  form.hidden = false;
  form.querySelector<HTMLInputElement>('[name=name]')!.focus();

  const order: string[] = [];
  const update = (e?: Event) => {
    const t = e?.target as HTMLInputElement | undefined;
    if (t?.name === 'pronouns') {
      const i = order.indexOf(t.value);
      if (i >= 0) order.splice(i, 1);
      if (t.checked) order.push(t.value);
    }
    // "Just my name" is exclusive with every set.
    if (t?.name === 'pronouns') {
      const boxes = [...form.querySelectorAll<HTMLInputElement>('[name=pronouns]')];
      if (t.value === 'name' && t.checked) boxes.forEach((b) => b !== t && (b.checked = false));
      if (t.value !== 'name' && t.checked) boxes.find((b) => b.value === 'name')!.checked = false;
    }
    custom.hidden = !form.querySelector<HTMLInputElement>('[name=pronouns][value=custom]')!.checked;
    const { player } = readForm(form, order);
    preview.textContent = player ? render(PREVIEW, { player, characters, lineKey: 'preview' }) : '';
  };
  form.addEventListener('input', update);
  update();

  return new Promise((resolve) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      const { player, error: msg } = readForm(form, order);
      error.textContent = msg ?? '';
      if (!player) return;
      form.removeEventListener('input', update);
      form.hidden = true;
      $('#box').hidden = false;
      resolve(player);
    };
  });
}
