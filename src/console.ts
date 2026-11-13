// The Query Shell dialog. All it does is collect SQL, show results and switch views; the actual
// read-only execution lives in db.console(), and the Logs / Trace / Metrics views in viz.ts.
import type { Row } from './db.ts';
import type { CaseFile } from './casefile.ts';
import { mountViews, type View, type Views } from './viz.ts';

export interface ConsoleOptions {
  hints: [label: string, sql: string][];
  /** Runs on the read-only connection and logs a query_run event. Views use it too. */
  run(sql: string): Promise<{ rows?: Row[]; note?: string; error?: string }>;
  table(rows: Row[], max?: number): HTMLElement;
  characters: Record<string, { name: string; color?: string }>;
  /** Open on this view instead of SQL. */
  view?: View;
  /** The Sev-1 case file, read fresh each time a view draws. */
  caseFile(): CaseFile;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let views: Views | undefined;
let current: ConsoleOptions;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

/** During the Sev-1: what's been found, and where to look next (with a button to that view). */
function drawCaseFile(o: ConsoleOptions, select: (name: string, focus?: boolean) => void) {
  const box = $<HTMLDetailsElement>('#casefile');
  const cf = o.caseFile();
  box.hidden = !cf.active;
  for (const t of document.querySelectorAll('#console [role=tab]')) t.classList.toggle('lead', !!cf.current && t.id === `tab-${cf.current.tab}`);
  if (!cf.active) return;
  const n = cf.leads.findIndex((l) => l === cf.current) + 1;
  const dot = (who: string) => {
    const i = el('i', 'dot');
    i.style.setProperty('--c', o.characters[who]?.color ?? 'var(--lilac-deep)');
    i.setAttribute('aria-hidden', 'true');
    return i;
  };
  box.replaceChildren(
    el('summary', '', el('strong', 'sev', 'SEV-1'), ' citizens not found', el('span', 'cf-progress', ` · lead ${n} of ${cf.leads.length}`)),
    el('ol', 'cf-leads', ...cf.leads.map((l) => {
      const li = el('li', l.state, dot(l.who), el('strong', '', l.title));
      li.setAttribute('aria-label', `${l.title}: ${l.state === 'found' ? `found. ${l.clue}` : l.state === 'current' ? `current lead. ${l.look}` : 'not yet'}`);
      if (l.state === 'found') li.append(el('span', 'cf-text', l.clue));
      if (l.state === 'current') {
        const go = el('button', 'viz-btn', `open ${l.tab === 'sql' ? 'SQL' : l.tab[0].toUpperCase() + l.tab.slice(1)}`);
        go.type = 'button';
        go.onclick = () => select(l.tab, true);
        li.append(el('span', 'cf-text', l.look), go);
      }
      return li;
    })),
  );
}

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
  views ??= mountViews({ run: o.run, table: o.table, characters: o.characters, select: (v) => select(v), caseFile: () => current.caseFile() });
  current = o;
  drawCaseFile(o, select);
  for (const [i, t] of tabs.entries()) {
    t.onclick = () => select(t.id.slice(4));
    t.onkeydown = (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length].id.slice(4), true);
    };
  }
  select(o.view ?? 'sql');

  dialog.showModal();
  if (!o.view) sql.focus();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(), { once: true }));
}
