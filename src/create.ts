// Character creation: a free-text name, stored as a span attribute on a `character_created`
// event. The player has no pronouns or gender in the game: they're always "you".
import { render, type Player, type PronounSet } from './engine/pronouns.ts';
import type { GameEvent } from './eventlog.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const PREVIEW = 'Logs: “Oh, {name}! I already like the sound of it. I’m writing it down. I’m writing everything down.”';

export function playerAttributes(p: Player): Record<string, string> {
  return { 'player.name': p.name };
}

/** Latest character from the event log (the log is the save file). */
export function playerFromEvents(events: GameEvent[]): Player | undefined {
  const e = events.findLast((x) => x.event_type === 'character_created');
  return e ? { name: e.attributes['player.name'] } : undefined;
}

export function createCharacter(characters: Record<string, PronounSet>): Promise<Player> {
  const form = $<HTMLFormElement>('#create');
  const input = form.querySelector<HTMLInputElement>('[name=name]')!;
  const preview = $('#preview');
  const error = $('#create-error');
  $('#box').hidden = true;
  form.hidden = false;
  input.focus();

  const update = () => {
    const name = input.value.trim();
    preview.textContent = name ? render(PREVIEW, { player: { name }, characters }) : '';
  };
  form.addEventListener('input', update);
  update();

  return new Promise((resolve) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      error.textContent = name ? '' : 'player.name is required (it can be anything).';
      if (!name) return;
      form.removeEventListener('input', update);
      form.hidden = true;
      $('#box').hidden = false;
      resolve({ name });
    };
  });
}
