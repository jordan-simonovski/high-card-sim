// The Query Shell's other views: Logs, Trace and Metrics. Each runs fixed queries through the
// shell's own run() (read-only connection, logged as query_run like a typed query) and draws
// them as hand-built HTML and SVG. Player input only filters rows client-side; it never reaches SQL.
import './viz.css';
import type { Row } from './db.ts';

export type View = 'logs' | 'trace' | 'metrics';
export interface Views {
  show(v: View): void;
}
type Run = (sql: string) => Promise<{ rows?: Row[]; note?: string; error?: string }>;
interface Opts {
  run: Run;
  table(rows: Row[], max?: number): HTMLElement;
  characters: Record<string, { name: string; color?: string }>;
  select(v: View): void;
}

export function mountViews(o: Opts): Views {
  const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
  const trace = traceView(o, $('#panel-trace'));
  const views = {
    logs: logsView(o, $('#panel-logs')),
    trace,
    metrics: metricsView(o, $('#panel-metrics'), (seq) => {
      trace.open(seq);
      o.select('trace');
    }),
  };
  return { show: (v) => void views[v].refresh() };
}

// ---------- shared bits ----------
type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...kids: Kid[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
function s(tag: string, attrs: Record<string, string | number | undefined> = {}, ...kids: Kid[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
const ICON = {
  chevron: 'M6 9l6 6 6-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  squash: 'M5 19l5-14M14 19l5-14',
};
const icon = (d: string) =>
  s('svg', { class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d }));

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;
/** DateTime64(3) comes back as 'YYYY-MM-DD hh:mm:ss.sss' in UTC. */
const parseTs = (v: unknown) => Date.parse(`${str(v).replace(' ', 'T')}Z`) || 0;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
function dur(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_500) return `${(ms / 1000).toFixed(ms < 9_950 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const esc = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROW_LIMIT = 500; // db.console()'s max_result_rows

/** A clean axis step: 1, 2 or 5 times a power of ten, or a clock-friendly step for durations. */
function niceStep(span: number, ticks: number, steps?: number[]) {
  const raw = span / ticks;
  if (steps) return steps.find((x) => x >= raw) ?? steps[steps.length - 1];
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw)!;
}
const TIME_STEPS = [100, 250, 500, 1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5];

/**
 * Elapsed "active" time: gaps longer than `cap` (the tab closed, the player went to bed) count
 * as `cap`, so one long break can't squash the rest of the session into a sliver.
 */
function activeTime<T extends { t: number }>(items: T[], cap: number) {
  let off = 0;
  const offs: number[] = [];
  const squashed: number[] = [];
  items.forEach((e, i) => {
    if (i) {
      const gap = Math.max(0, e.t - items[i - 1].t);
      if (gap > cap) squashed.push(off + cap / 2);
      off += Math.min(gap, cap);
    }
    offs.push(off);
  });
  return { offs, end: Math.max(off, 1), squashed };
}

function statusLine() {
  const code = h('code');
  const note = h('span', { class: 'viz-note-text' });
  const el = h('p', { class: 'viz-status' }, code, ' ', note);
  return {
    el,
    set(sql: string, text = '', error = false) {
      code.textContent = sql;
      note.textContent = text;
      note.classList.toggle('error', error);
    },
  };
}

/** Run a view's fixed query, holding the previous render at reduced opacity while it loads. */
async function load(o: Opts, busy: HTMLElement, status: ReturnType<typeof statusLine>, sql: string) {
  busy.classList.add('busy');
  status.set(sql, 'running…');
  const r = await o.run(sql);
  busy.classList.remove('busy');
  if (r.error) status.set(sql, r.error, true);
  else status.set(sql, `${r.note ?? ''}${(r.rows?.length ?? 0) >= ROW_LIMIT ? ' · the shell stops at 500 rows' : ''}`);
  return r.error ? undefined : (r.rows ?? []);
}

function who(o: Opts, id: string) {
  if (!id) return { name: 'narration', color: '' };
  const c = o.characters[id];
  return { name: c?.name ?? id, color: c?.color ?? 'var(--lilac-deep)' };
}
/** A character's colour mark. Narration gets its own outlined lilac mark. */
function dot(o: Opts, id: string, cls = 'dot') {
  const c = who(o, id).color;
  return h('i', { class: `${cls}${c ? '' : ' narr'}`, style: c ? `--c: ${c}` : undefined, 'aria-hidden': 'true' });
}
const seg = (labels: [value: string, label: string][], aria: string, onPick: (v: string) => void) => {
  const buttons = labels.map(([v, label]) => {
    const b = h('button', { type: 'button', class: 'viz-seg', 'data-value': v, 'aria-pressed': 'false' }, label);
    b.onclick = () => onPick(v);
    return b;
  });
  return {
    el: h('div', { class: 'viz-segs', role: 'group', 'aria-label': aria }, ...buttons),
    set: (v: string) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v))),
  };
};

// ---------- Logs: every word, no idea what any of it meant ----------
const LOGS_SQL = "SELECT ts, character, dialogue_text FROM logs WHERE dialogue_text != '' ORDER BY ts DESC LIMIT 1000";

function logsView(o: Opts, panel: HTMLElement) {
  type Line = { t: number; character: string; text: string };
  let lines: Line[] = [];
  const picked = new Set<string>();
  let newest = true;

  const search = h('input', { type: 'search', id: 'logs-search', placeholder: 'search what Logs heard', autocomplete: 'off', spellcheck: 'false' });
  const order = h('button', { type: 'button', class: 'viz-btn', id: 'logs-order' });
  const chips = h('div', { class: 'viz-chips', role: 'group', 'aria-label': 'Filter by character' });
  const count = h('p', { class: 'viz-count', role: 'status', id: 'logs-count' });
  const list = h('ol', { class: 'log-list', id: 'logs-list', 'aria-label': 'Log lines' });
  const status = statusLine();
  panel.append(
    h('div', { class: 'viz-controls' }, h('label', { class: 'viz-search' }, icon(ICON.search), h('span', { class: 'sr-only' }, 'Search lines'), search), order),
    chips,
    status.el,
    count,
    list,
  );
  search.oninput = draw;
  order.onclick = () => {
    newest = !newest;
    draw();
  };

  function highlight(text: string, q: string): (string | Node)[] {
    if (!q) return [text];
    return text
      .split(new RegExp(`(${esc(q)})`, 'gi'))
      .map((part, i) => (i % 2 ? h('mark', {}, part) : part))
      .filter((p) => p !== '');
  }

  function drawChips() {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.character, (counts.get(l.character) ?? 0) + 1);
    for (const p of [...picked]) if (!counts.has(p)) picked.delete(p);
    chips.replaceChildren(
      ...[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => {
          const name = who(o, id).name;
          const b = h('button', { type: 'button', class: 'viz-chip', 'aria-pressed': String(picked.has(id)), 'aria-label': `${name}, ${n} lines` }, dot(o, id), name, h('span', { class: 'n' }, String(n)));
          b.onclick = () => {
            if (picked.has(id)) picked.delete(id);
            else picked.add(id);
            b.setAttribute('aria-pressed', String(picked.has(id)));
            draw();
          };
          return b;
        }),
    );
  }

  function draw() {
    order.replaceChildren(icon(newest ? ICON.down : ICON.up), newest ? 'newest first' : 'oldest first');
    const q = search.value.trim();
    const re = q ? new RegExp(esc(q), 'i') : undefined;
    const shown = lines.filter((l) => (!picked.size || picked.has(l.character)) && (!re || re.test(l.text)));
    if (!newest) shown.reverse();
    count.textContent = lines.length ? `${shown.length} of ${lines.length} lines` : '';
    if (!lines.length) {
      list.replaceChildren(h('li', { class: 'viz-empty' }, "Logs hasn't heard a word yet. Play a little, then look again."));
      return;
    }
    if (!shown.length) {
      const clear = h('button', { type: 'button', class: 'viz-btn' }, 'clear filters');
      clear.onclick = () => {
        search.value = '';
        picked.clear();
        drawChips();
        draw();
        search.focus();
      };
      list.replaceChildren(h('li', { class: 'viz-empty' }, q ? `Nothing Logs heard matches “${q}”. ` : 'No lines from that character. ', clear));
      return;
    }
    list.replaceChildren(
      ...shown.map((l) =>
        h('li', {}, h('time', { class: 'ts' }, clock(l.t)), h('span', { class: 'who' }, dot(o, l.character), who(o, l.character).name), h('span', { class: 'line' }, ...highlight(l.text, q))),
      ),
    );
  }

  return {
    async refresh() {
      const rows = await load(o, list, status, LOGS_SQL);
      if (!rows) return;
      lines = rows.map((r) => ({ t: parseTs(r.ts), character: str(r.character), text: str(r.dialogue_text) }));
      drawChips();
      draw();
    },
  };
}

// ---------- Trace: a waterfall of the session, sampled or whole ----------
const TRACE_COLS = 'seq, ts, scene, node, event_type, character, choice_text, dialogue_text, time_to_choose_ms';
const TRACE_TYPES = "event_type IN ('scene_enter', 'line', 'choice', 'ending')";
const TRACE_SQL = {
  traces: `SELECT ${TRACE_COLS} FROM traces WHERE ${TRACE_TYPES} ORDER BY seq`,
  events: `SELECT ${TRACE_COLS} FROM events WHERE ${TRACE_TYPES} ORDER BY seq`,
};
const MOMENTS_SQL = "SELECT count() AS n FROM logs WHERE dialogue_text != ''";
const IDLE_CAP = 60_000;
type Source = keyof typeof TRACE_SQL;

function traceView(o: Opts, panel: HTMLElement) {
  let source: Source = 'traces';
  let selected: number | undefined;
  let pending: number | undefined;
  const collapsed = new Set<string>();

  const sources = seg(
    [['traces', 'traces (sampled)'], ['events', 'events (everything)']],
    'Trace source',
    (v) => {
      source = v as Source;
      void refresh();
    },
  );
  const summary = h('p', { class: 'wf-summary', role: 'status', id: 'trace-summary' });
  const status = statusLine();
  const scroll = h('div', { class: 'wf-scroll' });
  const legend = h('p', { class: 'wf-legend', hidden: '' });
  const details = h('section', { class: 'wf-details', id: 'trace-details', 'aria-label': 'Span details', hidden: '' });
  panel.append(h('div', { class: 'viz-controls' }, sources.el), summary, status.el, legend, scroll, details);

  type Ev = { seq: number; t: number; off: number; scene: string; type: string; character: string; text: string; ttc: number; row: Row };

  function build(rows: Row[], moments?: number) {
    const evs: Ev[] = rows
      .map((r) => ({
        seq: num(r.seq), t: parseTs(r.ts), off: 0, scene: str(r.scene), type: str(r.event_type), character: str(r.character),
        text: str(r.choice_text) || str(r.dialogue_text), ttc: num(r.time_to_choose_ms), row: r,
      }))
      .sort((a, b) => a.seq - b.seq);
    const time = activeTime(evs, IDLE_CAP);
    evs.forEach((e, i) => (e.off = time.offs[i]));
    const end = time.end;
    const pct = (v: number) => `${Math.min(100, Math.max(0, (v / end) * 100))}%`;
    const isMoment = (e: Ev) => e.type === 'line' || e.type === 'choice';
    const spans = evs.filter(isMoment).length;

    // Scenes: a new one at each scene_enter, or wherever the scene changes (the sample rarely keeps a scene_enter).
    type Group = { key: string; scene: string; start: number; end: number; items: number[] };
    const groups: Group[] = [];
    evs.forEach((e, i) => {
      const g = groups.at(-1);
      if (!g || e.type === 'scene_enter' || e.scene !== g.scene) groups.push({ key: `${e.scene}@${e.seq}`, scene: e.scene, start: e.off, end: e.off, items: [] });
      if (isMoment(e)) groups.at(-1)!.items.push(i);
    });
    groups.forEach((g, k) => (g.end = groups[k + 1]?.start ?? end));

    // Unsampled space: wherever seq skips, Traces wasn't looking.
    const gaps: { from: number; to: number; missing: number }[] = [];
    if (source === 'traces')
      evs.forEach((e, i) => {
        const n = evs[i + 1];
        if (n && n.seq > e.seq + 1) gaps.push({ from: e.off, to: n.off, missing: n.seq - e.seq - 1 });
      });
    const unsampled = gaps.reduce((a, g) => a + g.missing, 0);

    if (source === 'traces') {
      const total = moments ?? spans;
      summary.replaceChildren(
        h('strong', {}, spans ? `Traces only saw ${spans} of ${total} moments.` : `Traces saw none of your ${total} moments.`),
        spans < total ? ' Switch to events (everything) for the rest.' : '',
      );
    } else summary.replaceChildren(h('strong', {}, `Every moment: ${spans} spans across ${groups.length} scenes.`));

    if (!evs.length) {
      legend.hidden = true;
      scroll.replaceChildren(h('p', { class: 'viz-empty' }, source === 'traces' ? 'Nothing sampled yet. Mark a moment as important and Traces will keep it.' : 'No events yet. Play a little, then look again.'));
      details.hidden = true;
      return;
    }

    // Axis: elapsed active time, with a mark wherever an idle gap was squashed.
    const step = niceStep(end, 5, TIME_STEPS);
    const ticks: Kid[] = [];
    for (let v = 0; v <= end + 1; v += step) {
      const at = (v / end) * 100;
      ticks.push(h('span', { class: `tick${at > 88 ? ' end' : ''}`, style: `left: ${at}%` }, v ? dur(v) : '0'));
    }
    for (const q of time.squashed) ticks.push(h('span', { class: 'squash', style: `left: ${pct(q)}`, title: 'idle gap squashed to 1 minute' }, icon(ICON.squash)));
    const axis = h('div', { class: 'wf-row axis', 'aria-hidden': 'true' }, h('span', { class: 'wf-label' }, 'elapsed'), h('span', { class: 'wf-track' }, ...ticks));
    const bands = h(
      'div',
      { class: 'wf-gaps', 'aria-hidden': 'true' },
      ...gaps.map((g) => h('span', { class: 'gap', style: `left: ${pct(g.from)}; width: calc(${pct(g.to)} - ${pct(g.from)})`, title: `${g.missing} unsampled` })),
    );
    const real = evs[evs.length - 1].t - evs[0].t;
    const root = h(
      'div',
      { class: 'wf-row root' },
      h('span', { class: 'wf-label' }, h('strong', {}, 'session'), h('small', {}, dur(real))),
      h('span', { class: 'wf-track' }, h('span', { class: 'bar session', style: 'left: 0; width: 100%' })),
    );

    const rowsEl: HTMLElement[] = [];
    for (const g of groups) {
      const open = !collapsed.has(g.key);
      const kids: HTMLButtonElement[] = g.items.map((i) => {
        const e = evs[i];
        const n = evs[i + 1];
        const contiguous = !!n && (source === 'events' || n.seq === e.seq + 1);
        const start = e.type === 'choice' ? Math.max(0, e.off - Math.min(e.ttc, IDLE_CAP)) : e.off;
        const stop = contiguous ? n.off : e.off;
        const { name, color } = who(o, e.character);
        const choice = e.type === 'choice';
        const lasted = contiguous ? n.t - e.t : 0;
        const label = `${name}: ${e.text}. ${choice ? `Choice, chosen in ${dur(e.ttc)}` : 'Line'}, at ${dur(e.off)}${contiguous ? `, lasted ${dur(lasted)}` : ', end unknown'}.`;
        const right = (stop / end) * 100 > 78;
        const b = h(
          'button',
          { type: 'button', class: `wf-row moment${choice ? ' choice' : ''}`, 'data-seq': String(e.seq), 'aria-label': label },
          h('span', { class: 'wf-label' }, dot(o, e.character), h('span', { class: 'who' }, name), choice ? h('span', { class: 'tag' }, 'choice') : '', h('span', { class: 'snip' }, e.text)),
          h(
            'span',
            { class: 'wf-track' },
            h('span', { class: `bar${choice ? ' choice' : ''}${color ? '' : ' narr'}`, style: `left: ${pct(start)}; width: calc(${pct(stop)} - ${pct(start)})${color ? `; --c: ${color}` : ''}` }),
            choice ? h('span', { class: `ttc${right ? ' before' : ''}`, style: right ? `right: calc(100% - ${pct(start)})` : `left: ${pct(stop)}` }, dur(e.ttc)) : '',
          ),
        );
        b.hidden = !open;
        b.onclick = () => pick(e.seq);
        return b;
      });
      const head = h(
        'button',
        { type: 'button', class: 'wf-row scene', 'aria-expanded': String(open) },
        h('span', { class: 'wf-label' }, icon(ICON.chevron), h('span', { class: 'who' }, g.scene || 'no scene'), h('small', {}, `${g.items.length}`)),
        h('span', { class: 'wf-track' }, h('span', { class: 'bar scene', style: `left: ${pct(g.start)}; width: calc(${pct(g.end)} - ${pct(g.start)})` })),
      );
      head.setAttribute('aria-label', `Scene ${g.scene}, ${g.items.length} spans, ${dur(g.end - g.start)}`);
      head.onclick = () => {
        const nowOpen = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) collapsed.delete(g.key);
        else collapsed.add(g.key);
        for (const k of kids) k.hidden = !nowOpen;
      };
      rowsEl.push(head, ...kids);
    }

    const wf = h('div', { class: 'wf', role: 'group', 'aria-label': `Waterfall, ${spans} spans` }, axis, bands, root, ...rowsEl);
    wf.onkeydown = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...wf.querySelectorAll<HTMLButtonElement>('button.wf-row:not([hidden])')];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      e.preventDefault();
      all[Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    };
    legend.hidden = !gaps.length;
    legend.replaceChildren(h('i', { class: 'swatch-gap', 'aria-hidden': 'true' }), `hatched: ${unsampled} events Traces never saw`);
    scroll.replaceChildren(wf);

    const rowBySeq = new Map(evs.map((e) => [e.seq, e.row]));
    function pick(seq: number, focus = false) {
      const row = rowBySeq.get(seq);
      if (!row) return;
      selected = seq;
      for (const b of wf.querySelectorAll<HTMLElement>('.moment')) {
        if (b.dataset.seq === String(seq)) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      }
      const el = wf.querySelector<HTMLButtonElement>(`.moment[data-seq="${seq}"]`);
      if (el?.hidden) expandFor(el);
      details.hidden = false;
      details.replaceChildren(
        h('h3', {}, 'span details'),
        h('dl', {}, ...TRACE_COLS.split(', ').flatMap((k) => [h('dt', {}, k), h('dd', { class: str(row[k]) ? '' : 'none' }, k === 'ts' ? `${str(row[k])} (${clock(parseTs(row[k]))} local)` : str(row[k]) || 'empty')])),
      );
      if (focus && el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center' });
      }
    }
    function expandFor(el: HTMLElement) {
      let head = el.previousElementSibling as HTMLElement | null;
      while (head && !head.classList.contains('scene')) head = head.previousElementSibling as HTMLElement | null;
      if (head?.getAttribute('aria-expanded') === 'false') head.click();
    }
    if (pending !== undefined && rowBySeq.has(pending)) pick(pending, true);
    else if (selected !== undefined && rowBySeq.has(selected)) pick(selected);
    else details.hidden = true;
    pending = undefined;
  }

  async function refresh() {
    sources.set(source);
    const rows = await load(o, scroll, status, TRACE_SQL[source]);
    if (!rows) return;
    let moments: number | undefined;
    if (source === 'traces') {
      const m = await o.run(MOMENTS_SQL);
      moments = m.rows ? num(m.rows[0]?.n) : undefined;
    }
    build(rows, moments);
  }

  return {
    refresh,
    /** Show this event's span from the whole events table (from a Metrics exemplar). */
    open(seq: number) {
      source = 'events';
      pending = seq;
    },
  };
}

// ---------- Metrics: totals, and the moments only the full table remembers ----------
type Kind = 'bar' | 'stacked' | 'stat' | 'time';
const METRICS_SQL = {
  bar: "SELECT character, sum(affection) AS affection FROM metrics_agg WHERE character != '' GROUP BY character ORDER BY affection DESC, character",
  stacked: 'SELECT scene, character, sum(events) AS events FROM metrics_agg GROUP BY scene, character ORDER BY scene, character',
  stat: 'SELECT character, sum(events) AS events, sum(affection) AS affection FROM metrics_agg GROUP BY character',
  statChoices: "SELECT count() AS choices FROM events WHERE event_type = 'choice'",
  time: "SELECT seq, ts, scene, node, character, choice_text, affection_delta, time_to_choose_ms FROM events WHERE event_type = 'choice' ORDER BY seq",
};
const CHART_IDLE_CAP = 5 * 60_000;
const PILLARS = ['logs', 'metrics', 'traces'];

function metricsView(o: Opts, panel: HTMLElement, openInTrace: (seq: number) => void) {
  let kind: Kind = 'bar';
  let rows: Row[] = [];
  let extra: Row[] = [];
  let drawnWidth = 0;

  const kinds = seg(
    [['bar', 'bar'], ['stacked', 'stacked'], ['stat', 'stat'], ['time', 'over time']],
    'Chart type',
    (v) => {
      kind = v as Kind;
      void refresh();
    },
  );
  const note = h('p', { class: 'viz-note', hidden: '' });
  const status = statusLine();
  const host = h('div', { class: 'chart', id: 'metrics-chart' });
  const numbers = h('details', { class: 'viz-table' });
  panel.append(h('div', { class: 'viz-controls' }, kinds.el), note, status.el, host, numbers);
  new ResizeObserver(() => {
    if (host.clientWidth && Math.abs(host.clientWidth - drawnWidth) > 4) draw();
  }).observe(host);

  // Order series by the character registry, so a colour always means the same entity.
  const order = Object.keys(o.characters);
  const rank = (id: string) => (id ? (order.indexOf(id) + 1 || order.length + 1) : order.length + 2);

  function tooltip(wrap: HTMLElement) {
    const el = h('div', { class: 'viz-tip', role: 'tooltip', hidden: '' });
    wrap.append(el);
    let pinned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t = {
      el,
      owner: undefined as SVGElement | undefined,
      get pinned() {
        return pinned;
      },
      show(x: number, y: number, kids: Kid[], pin = false) {
        clearTimeout(timer);
        pinned = pin || (pinned && !el.hidden);
        el.replaceChildren(...kids.filter((k): k is Node | string => !!k));
        el.classList.toggle('pinned', pinned); // a hover tooltip never blocks the marks under it
        el.hidden = false;
        const w = el.offsetWidth;
        const ht = el.offsetHeight;
        el.style.left = `${Math.max(4, Math.min(x - w / 2, wrap.clientWidth - w - 4))}px`;
        el.style.top = `${y - ht - 14 < 0 ? y + 16 : y - ht - 14}px`;
      },
      hide(force = false) {
        if (pinned && !force) return;
        pinned = false;
        el.hidden = true;
      },
      later() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!el.matches(':hover') && !el.contains(document.activeElement)) t.hide();
        }, 140);
      },
    };
    // Touch has no hover-away: a tap anywhere else in the chart unpins.
    wrap.addEventListener('pointerdown', (e) => {
      const at = e.target as Node;
      if (pinned && !el.contains(at) && !t.owner?.contains(at)) t.hide(true);
    });
    el.onpointerenter = () => clearTimeout(timer);
    el.onpointerleave = () => t.later();
    el.addEventListener('focusout', () => t.later());
    el.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // close the tooltip, not the dialog
      t.hide(true);
      (t.owner as unknown as HTMLElement | undefined)?.focus();
    };
    return t;
  }

  /** Hover, focus or tap on a mark shows its tooltip; Enter pins it (and focuses its action, if any). */
  function wire(mark: SVGElement, tip: ReturnType<typeof tooltip>, at: () => [number, number], content: () => Kid[], action?: () => HTMLButtonElement) {
    const show = (pin = false) => {
      tip.owner = mark;
      tip.show(...at(), content(), pin);
    };
    mark.addEventListener('pointerenter', () => show());
    mark.addEventListener('pointerleave', () => tip.later());
    mark.addEventListener('focus', () => show());
    mark.addEventListener('blur', () => tip.later());
    mark.addEventListener('click', () => show(!!action));
    mark.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Escape' && !tip.el.hidden) {
        e.preventDefault(); // close the tooltip, not the dialog
        tip.hide(true);
      }
      if ((k === 'Enter' || k === ' ') && action) {
        e.preventDefault();
        show(true);
        tip.el.querySelector('button')?.focus();
      }
    });
  }

  function hbar(x0: number, x1: number, y: number, ht: number, r = 4) {
    const w = Math.abs(x1 - x0);
    r = Math.min(r, w, ht / 2);
    const d = x1 >= x0 ? 1 : -1;
    return `M${x0},${y}H${x1 - d * r}Q${x1},${y} ${x1},${y + r}V${y + ht - r}Q${x1},${y + ht} ${x1 - d * r},${y + ht}H${x0}Z`;
  }
  const empty = (text: string) => host.replaceChildren(h('p', { class: 'viz-empty' }, text));

  function barChart(W: number) {
    const data = rows.map((r) => ({ id: str(r.character), v: num(r.affection) }));
    if (!data.length) return empty("Metrics hasn't counted anyone yet.");
    const labelW = Math.min(130, W * 0.3);
    const valW = 44;
    const rowH = 40;
    const barH = 20;
    const H = data.length * rowH + 8;
    const lo = Math.min(0, ...data.map((d) => d.v));
    const hi = Math.max(0, ...data.map((d) => d.v), lo === 0 ? 1 : 0);
    const px0 = labelW + (lo < 0 ? valW : 0);
    const px1 = W - valW;
    const x = (v: number) => px0 + ((v - lo) / (hi - lo || 1)) * (px1 - px0);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Affection by character, sum(affection) from metrics_agg: ${data.map((d) => `${who(o, d.id).name} ${signed(d.v)}`).join(', ')}.` });
    const tip = tooltip(host);
    svg.append(s('line', { class: 'zero', x1: x(0), x2: x(0), y1: 2, y2: H - 4 }));
    data.forEach((d, i) => {
      const y = i * rowH + 4;
      const { name, color } = who(o, d.id);
      const g = s('g', { class: 'mark', tabindex: 0, 'aria-label': `${name}: ${signed(d.v)} affection` });
      g.append(
        ...[
          s('rect', { class: 'hit', x: 0, y, width: W, height: rowH }),
        s('text', { class: 'label', x: 0, y: y + rowH / 2, 'dominant-baseline': 'central' }, name),
        d.v ? s('path', { class: 'fill', d: hbar(x(0), x(d.v), y + (rowH - barH) / 2, barH), style: `--c: ${color}` }) : null,
          s('text', { class: 'value', x: x(d.v) + (d.v < 0 ? -6 : 6), y: y + rowH / 2, 'dominant-baseline': 'central', 'text-anchor': d.v < 0 ? 'end' : 'start' }, signed(d.v)),
        ].filter((k): k is SVGElement => !!k),
      );
      wire(g, tip, () => [x(d.v), y + 6], () => [h('strong', { class: 'tip-value' }, `${signed(d.v)} affection`), h('span', {}, `${name} · sum(affection)`)]);
      svg.append(g);
    });
    host.replaceChildren(svg, tip.el);
  }

  function stackedChart(W: number) {
    const scenes = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = scenes.get(str(r.scene)) ?? new Map<string, number>();
      m.set(str(r.character), (m.get(str(r.character)) ?? 0) + num(r.events));
      scenes.set(str(r.scene), m);
    }
    if (!scenes.size) return empty("Metrics hasn't counted any events yet.");
    const chars = [...new Set(rows.map((r) => str(r.character)))].sort((a, b) => rank(a) - rank(b));
    const list = [...scenes].map(([scene, m]) => ({ scene, m, total: [...m.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
    const max = Math.max(...list.map((l) => l.total), 1);
    const labelW = Math.min(140, W * 0.32);
    const valW = 44;
    const rowH = 40;
    const barH = 20;
    const H = list.length * rowH + 8;
    const plot = W - labelW - valW;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Events per scene by character, from metrics_agg. ${list.map((l) => `${l.scene}: ${l.total}`).join(', ')}.` });
    const tip = tooltip(host);
    list.forEach((l, i) => {
      const y = i * rowH + 4;
      svg.append(s('text', { class: 'label', x: 0, y: y + rowH / 2, 'dominant-baseline': 'central' }, l.scene || 'no scene'));
      let x = labelW;
      const present = chars.filter((c) => l.m.get(c));
      present.forEach((c, k) => {
        const v = l.m.get(c)!;
        const w = (v / max) * plot;
        const last = k === present.length - 1;
        const { name, color } = who(o, c);
        const x1 = x + Math.max(1, last ? w : w - 2); // 2px surface gap between segments
        const g = s('g', { class: 'mark', tabindex: 0, 'aria-label': `${l.scene}, ${name}: ${v} events` });
        g.append(
          last ? s('path', { class: `fill${color ? '' : ' narr'}`, d: hbar(x, x1, y + (rowH - barH) / 2, barH), style: color ? `--c: ${color}` : undefined }) : s('rect', { class: `fill${color ? '' : ' narr'}`, x, y: y + (rowH - barH) / 2, width: x1 - x, height: barH, style: color ? `--c: ${color}` : undefined }),
        );
        const mid = x + w / 2;
        wire(g, tip, () => [mid, y + 6], () => [h('strong', { class: 'tip-value' }, `${v} events`), h('span', {}, `${name} · ${l.scene}`)]);
        svg.append(g);
        x += w;
      });
      svg.append(s('text', { class: 'value', x: x + 6, y: y + rowH / 2, 'dominant-baseline': 'central' }, String(l.total)));
    });
    const legend = h('div', { class: 'viz-legend', 'aria-hidden': 'true' }, ...chars.map((c) => h('span', {}, dot(o, c, 'swatch'), who(o, c).name)));
    host.replaceChildren(legend, svg, tip.el);
  }

  function statTiles() {
    const by = new Map(rows.map((r) => [str(r.character), r]));
    const events = rows.reduce((a, r) => a + num(r.events), 0);
    const tile = (label: Kid[], value: string, src: string) => h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, ...label), h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-src' }, src));
    host.replaceChildren(
      h(
        'div',
        { class: 'tiles' },
        tile(['Events'], events.toLocaleString(), 'sum(events) · metrics_agg'),
        tile(['Choices'], num(extra[0]?.choices).toLocaleString(), 'count() · events'),
        ...PILLARS.map((p) => tile([dot(o, p), `${who(o, p).name} affection`], signed(num(by.get(p)?.affection)), 'sum(affection) · metrics_agg')),
      ),
    );
  }

  function timeChart(W: number) {
    const cs = rows.map((r) => ({
      seq: num(r.seq), t: parseTs(r.ts), scene: str(r.scene), character: str(r.character), text: str(r.choice_text), delta: num(r.affection_delta), ttc: num(r.time_to_choose_ms),
    }));
    const ids = [...new Set(cs.filter((c) => c.delta).map((c) => c.character))].sort((a, b) => rank(a) - rank(b));
    if (!ids.length) return empty(cs.length ? `${cs.length} choices so far, and none of them moved anyone's affection yet.` : 'No choices yet. Play a little, then look again.');
    const time = activeTime(cs, CHART_IDLE_CAP);
    const narrow = W < 460;
    const m = { l: 36, r: narrow ? 14 : 92, t: 14, b: 30 };
    const H = narrow ? 220 : 260;
    const series = ids.map((id) => {
      let cum = 0;
      const pts = cs.flatMap((c, i) => (c.character === id && c.delta ? [{ c, off: time.offs[i], v: (cum += c.delta) }] : []));
      return { id, pts, last: cum };
    });
    const vals = series.flatMap((sr) => sr.pts.map((p) => p.v));
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (lo === hi) hi = 1;
    const step = Math.max(1, niceStep(hi - lo, 4));
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const x = (off: number) => m.l + (off / time.end) * (W - m.l - m.r);
    const y = (v: number) => m.t + ((hi - v) / (hi - lo)) * (H - m.t - m.b);
    const svg = s('svg', {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group',
      'aria-label': `Cumulative affection over time, from events. ${series.map((sr) => `${who(o, sr.id).name} ends at ${signed(sr.last)}`).join(', ')}. Each dot is a choice that changed affection.`,
    });
    for (let v = lo; v <= hi; v += step) {
      svg.append(s('line', { class: v === 0 ? 'zero' : 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'tick', x: m.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'central' }, signed(v)));
    }
    const xStep = niceStep(time.end, narrow ? 3 : 5, TIME_STEPS);
    for (let v = 0; v <= time.end + 1; v += xStep) svg.append(s('text', { class: 'tick', x: x(v), y: H - 8, 'text-anchor': v === 0 ? 'start' : x(v) > W - 40 ? 'end' : 'middle' }, v ? dur(v) : '0'));
    const tip = tooltip(host);
    const labels: { y: number; id: string; v: number }[] = [];
    for (const sr of series) {
      const { name, color } = who(o, sr.id);
      let d = `M${x(0)},${y(0)}`;
      for (const p of sr.pts) d += `H${x(p.off)}V${y(p.v)}`;
      d += `H${x(time.end)}`;
      svg.append(s('path', { class: 'line', d, style: `--c: ${color || 'var(--lilac)'}` }));
      labels.push({ y: y(sr.last), id: sr.id, v: sr.last });
      for (const p of sr.pts) {
        const px = x(p.off);
        const py = y(p.v);
        const g = s('g', { class: 'ex', tabindex: 0, role: 'button', 'aria-label': `${name} ${signed(p.c.delta)} at ${p.c.scene}: “${p.c.text}”. Press Enter for details and to open it in the trace.` });
        g.append(s('circle', { class: 'hit', cx: px, cy: py, r: 20 }), s('circle', { class: 'ring', cx: px, cy: py, r: 9 }), s('circle', { class: 'dotm', cx: px, cy: py, r: 5, style: `--c: ${color || 'var(--lilac)'}` }));
        const btn = () => {
          const b = h('button', { type: 'button', class: 'viz-btn tip-action' }, 'open in trace', icon(ICON.arrow));
          b.onclick = () => {
            tip.hide(true);
            openInTrace(p.c.seq);
          };
          return b;
        };
        wire(
          g, tip, () => [px, py],
          () => [
            h('strong', { class: 'tip-value' }, `${signed(p.c.delta)} affection`),
            h('span', { class: 'tip-who' }, h('i', { class: 'key', style: `--c: ${color || 'var(--lilac)'}`, 'aria-hidden': 'true' }), `${name} · now ${signed(p.v)}`),
            h('span', {}, `scene ${p.c.scene}`),
            h('q', {}, p.c.text),
            h('span', {}, `chose in ${dur(p.c.ttc)}`),
            btn(),
          ],
          btn,
        );
        svg.append(g);
      }
    }
    // End labels only where they don't collide; the legend always carries identity.
    if (!narrow) {
      labels.sort((a, b) => a.y - b.y);
      labels.forEach((l, i) => {
        if (labels.some((k, j) => j !== i && Math.abs(k.y - l.y) < 16)) return;
        svg.append(s('text', { class: 'end', x: W - m.r + 8, y: l.y, 'dominant-baseline': 'central' }, `${who(o, l.id).name} ${signed(l.v)}`));
      });
    }
    host.onpointerdown = (e) => {
      if (!(e.target as Element).closest('.ex, .viz-tip')) tip.hide(true);
    };
    const legend = h('div', { class: 'viz-legend', 'aria-hidden': 'true' }, ...ids.map((id) => h('span', {}, h('i', { class: 'key', style: `--c: ${who(o, id).color || 'var(--lilac)'}` }), who(o, id).name)));
    host.replaceChildren(legend, svg, tip.el);
  }

  function draw() {
    const W = host.clientWidth;
    if (!W) return;
    drawnWidth = W;
    if (kind === 'bar') barChart(W);
    else if (kind === 'stacked') stackedChart(W);
    else if (kind === 'stat') statTiles();
    else timeChart(W);
  }

  async function refresh() {
    kinds.set(kind);
    note.hidden = kind !== 'time' && kind !== 'stat';
    note.textContent =
      kind === 'time'
        ? 'Over time and its exemplars read events, the whole table: metrics_agg only keeps totals, so Metrics can’t remember when anything happened.'
        : 'Choices are counted from events: metrics_agg keeps totals per character and scene, not what kind of moment each one was.';
    const r = await load(o, host, status, METRICS_SQL[kind]);
    if (!r) return;
    rows = r;
    extra = kind === 'stat' ? ((await o.run(METRICS_SQL.statChoices)).rows ?? []) : [];
    numbers.replaceChildren(h('summary', {}, 'show the numbers'), o.table(rows, 200));
    numbers.hidden = kind === 'stat';
    draw();
  }

  return { refresh };
}
