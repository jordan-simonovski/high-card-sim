// The Query Shell dialog. All it does is collect SQL and show results; the actual
// read-only execution lives in db.console().
import type { Row } from './db.ts';

export interface ConsoleOptions {
  hints: [label: string, sql: string][];
  run(sql: string): Promise<{ rows?: Row[]; note?: string; error?: string }>;
  table(rows: Row[], max?: number): HTMLElement;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

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

  dialog.showModal();
  sql.focus();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(), { once: true }));
}
