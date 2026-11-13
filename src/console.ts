// The Query Shell dialog. All it does is collect SQL, show results and switch views; the actual
// read-only execution lives in db.console(), and the Logs / Trace / Metrics views in viz.ts.
import type { Row } from './db.ts';
import { mountViews, type View, type Views } from './viz.ts';

export interface ConsoleOptions {
  hints: [label: string, sql: string][];
  /** Runs on the read-only connection and logs a query_run event. Views use it too. */
  run(sql: string): Promise<{ rows?: Row[]; note?: string; error?: string }>;
  table(rows: Row[], max?: number): HTMLElement;
  characters: Record<string, { name: string; color?: string }>;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let views: Views | undefined;

/** Opens the shell; resolves when the player closes it. */
export function openConsole(o: ConsoleOptions): Promise<void> {
  const dialog = $<HTMLDialogElement>('#console');
  const sql = $<HTMLTextAreaElement>('#sql');
  const status = $('#console-status');
  const result = $('#console-result');

  $('#hints').replaceChildren(
    ...o.hints.map(([label, q]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        sql.value = q;
        sql.focus();
      };
      return b;
    }),
  );

  let busy = false;
  const run = async () => {
    if (busy || !sql.value.trim()) return;
    busy = true;
    status.className = '';
    status.textContent = 'running…';
    const r = await o.run(sql.value);
    busy = false;
    if (r.error) {
      status.className = 'error';
      status.textContent = r.error;
      return;
    }
    status.textContent = r.note ?? '';
    result.replaceChildren(o.table(r.rows ?? [], 200));
  };
  $('#run').onclick = run;
  sql.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  };

  // Tabs: roving tabindex, arrows / Home / End move and select (automatic activation).
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const select = (name: string, focus = false) => {
    for (const t of tabs) {
      const on = t.id === `tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
      if (on && focus) t.focus();
    }
    if (name !== 'sql') views!.show(name as View);
  };
  views ??= mountViews({ run: o.run, table: o.table, characters: o.characters, select: (v) => select(v) });
  for (const [i, t] of tabs.entries()) {
    t.onclick = () => select(t.id.slice(4));
    t.onkeydown = (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length].id.slice(4), true);
    };
  }
  select('sql');

  dialog.showModal();
  sql.focus();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(), { once: true }));
}
