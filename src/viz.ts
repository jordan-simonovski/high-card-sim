// The Query Shell's other views: Logs, Trace and Metrics. Each runs fixed queries through the
// shell's own run() (read-only connection, logged as query_run like a typed query) and draws
// them as hand-built HTML and SVG. Player input only filters rows client-side; it never reaches SQL.
import './viz.css';
import type { Row } from './db.ts';
import type { CaseFile } from './casefile.ts';

export type View = 'logs' | 'trace' | 'metrics' | 'deltas';
export interface Views {
  show(v: View): void;
}
type Run = (sql: string) => Promise<{ rows?: Row[]; note?: string; error?: string }>;
interface Opts {
  run: Run;
  table(rows: Row[], max?: number): HTMLElement;
  characters: Record<string, { name: string; color?: string }>;
  select(v: View): void;
  /** The Sev-1 case file, as of now. */
  caseFile(): CaseFile;
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
    deltas: deltasView(o, $('#panel-deltas')),
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
  if (id === 'realm') return { name: 'the Realm', color: 'var(--ink-soft)' };
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
// Level and patterns are fixed choices, so they can go into the SQL and reach every line, not
// just the 500 the shell returns. Free text (search) still only filters client-side.
const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;
type Level = (typeof LEVELS)[number] | '';
const levelOf = (text: string) => LEVELS.find((l) => text.startsWith(`${l} `)) ?? '';
const LOGS_SQL = (level: Level, patterns: boolean) => {
  const where = `dialogue_text != ''${level ? ` AND startsWith(dialogue_text, '${level} ')` : ''}`;
  return patterns
    ? // Any run with a digit in it (ids, durations, counts) becomes #, so repeats collapse into one pattern.
      `SELECT replaceRegexpAll(dialogue_text, '[0-9a-f]*[0-9][0-9a-f]*', '#') AS pattern, count() AS n, any(character) AS character, max(ts) AS ts FROM logs WHERE ${where} GROUP BY pattern ORDER BY n DESC, ts DESC LIMIT 200`
    : `SELECT ts, character, dialogue_text FROM logs WHERE ${where} ORDER BY ts DESC LIMIT 1000`;
};

function logsView(o: Opts, panel: HTMLElement) {
  type Line = { t: number; character: string; text: string; n?: number };
  let lines: Line[] = [];
  const picked = new Set<string>();
  let newest = true;
  let level: Level = '';
  let patterns = false;

  const search = h('input', { type: 'search', id: 'logs-search', placeholder: 'search what Logs heard', autocomplete: 'off', spellcheck: 'false' });
  const order = h('button', { type: 'button', class: 'viz-btn', id: 'logs-order' });
  const group = h('button', { type: 'button', class: 'viz-btn', id: 'logs-patterns', 'aria-pressed': 'false' }, 'patterns');
  const levels = seg([['', 'all'], ...LEVELS.map((l): [string, string] => [l, l])], 'Filter by level', (v) => {
    level = v as Level;
    void refresh();
  });
  levels.el.id = 'logs-levels';
  const chips = h('div', { class: 'viz-chips', role: 'group', 'aria-label': 'Filter by character' });
  const count = h('p', { class: 'viz-count', role: 'status', id: 'logs-count' });
  const list = h('ol', { class: 'log-list', id: 'logs-list', 'aria-label': 'Log lines' });
  const status = statusLine();
  panel.append(
    h('div', { class: 'viz-controls' }, h('label', { class: 'viz-search' }, icon(ICON.search), h('span', { class: 'sr-only' }, 'Search lines'), search), order),
    h('div', { class: 'viz-controls' }, levels.el, group),
    chips,
    count,
    list,
    status.el, // the query goes under what it found, so the lines start higher up
  );
  search.oninput = draw;
  order.onclick = () => {
    newest = !newest;
    draw();
  };
  group.onclick = () => {
    patterns = !patterns;
    void refresh();
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
    for (const l of lines) counts.set(l.character, (counts.get(l.character) ?? 0) + (l.n ?? 1));
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
    if (!newest && !patterns) shown.reverse();
    const total = lines.reduce((a, l) => a + (l.n ?? 1), 0);
    count.textContent = !lines.length ? '' : patterns ? `${shown.length} of ${lines.length} patterns, from ${total.toLocaleString()} lines` : `${shown.length} of ${lines.length} lines`;
    if (!lines.length) {
      list.replaceChildren(h('li', { class: 'viz-empty' }, level ? `No ${level} lines.` : "Logs hasn't heard a word yet. Play a little, then look again."));
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
    list.classList.toggle('patterns', patterns);
    list.replaceChildren(
      ...shown.map((l) =>
        h('li', { class: levelOf(l.text) ? `lvl-${levelOf(l.text).toLowerCase()}` : undefined },
          patterns ? h('span', { class: 'ts n', 'aria-label': `${l.n} lines` }, `×${l.n}`) : h('time', { class: 'ts' }, clock(l.t)),
          h('span', { class: 'who' }, dot(o, l.character), who(o, l.character).name),
          h('span', { class: 'line' }, ...highlight(l.text, q))),
      ),
    );
  }

  async function refresh() {
    // Levels only mean something once the Realm is writing lines (the incident); before that, it's just you.
    const cf = o.caseFile();
    levels.el.hidden = group.hidden = !(cf.active || cf.resolved);
    if (levels.el.hidden) {
      level = '';
      patterns = false;
    }
    levels.set(level);
    group.setAttribute('aria-pressed', String(patterns));
    order.hidden = patterns;
    const rows = await load(o, list, status, LOGS_SQL(level, patterns));
    if (!rows) return;
    lines = rows.map((r) => ({ t: parseTs(r.ts), character: str(r.character), text: str(r.pattern ?? r.dialogue_text), n: patterns ? num(r.n) : undefined }));
    drawChips();
    draw();
  }

  return { refresh };
}

// ---------- Trace: a waterfall of the session, sampled or whole ----------
const TRACE_COLS = 'seq, ts, scene, node, event_type, character, choice_text, dialogue_text, time_to_choose_ms';
const TRACE_TYPES = "event_type IN ('scene_enter', 'line', 'choice', 'ending')";
const TRACE_SQL = {
  traces: `SELECT ${TRACE_COLS} FROM traces WHERE ${TRACE_TYPES} ORDER BY seq`,
  events: `SELECT ${TRACE_COLS} FROM events WHERE ${TRACE_TYPES} ORDER BY seq`,
};
const MOMENTS_SQL = "SELECT count() AS n FROM logs WHERE dialogue_text != '' AND character != 'realm'";
/** The Realm's requests during the incident: kept traces first, then failing ones, six at most. */
const REALM_SQL = (src: Source) =>
  `SELECT attributes['trace_id'] AS trace_id, attributes['span_id'] AS span_id, attributes['parent_span_id'] AS parent, ` +
  `attributes['service'] AS service, attributes['status'] AS status, attributes['duration_ms'] AS ms, ` +
  `attributes['request'] AS request, attributes['sampling.priority'] AS kept FROM ${src} ` +
  `WHERE event_type = 'realm_span' AND attributes['trace_id'] IN (SELECT attributes['trace_id'] FROM ${src} ` +
  `WHERE event_type = 'realm_span' GROUP BY attributes['trace_id'] ORDER BY max(attributes['sampling.priority'] = '1') DESC, ` +
  `max(attributes['status'] = 'error') DESC, max(ts) DESC LIMIT 6) ORDER BY ts`;
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
  const realm = h('section', { class: 'wf-realm', id: 'trace-realm', 'aria-label': 'Realm requests', hidden: '' });
  const you = h('h3', { class: 'wf-you', hidden: '' }, 'Your session');
  // The Realm's requests come first: during the incident they're what you're here for.
  panel.append(h('div', { class: 'viz-controls' }, sources.el), realm, you, summary, legend, scroll, details, status.el);

  /** One mini waterfall per Realm request; a span whose parent wasn't sampled says so. */
  function drawRealm(rows: Row[]) {
    realm.hidden = you.hidden = !rows.length;
    if (!rows.length) return;
    const traces = new Map<string, Row[]>();
    for (const r of rows) traces.set(str(r.trace_id), [...(traces.get(str(r.trace_id)) ?? []), r]);
    const max = Math.max(1, ...rows.map((r) => num(r.ms)));
    const score = (spans: Row[]) => (spans.some((sp) => str(sp.kept) === '1') ? 2 : 0) + (spans.some((sp) => str(sp.status) === 'error') ? 1 : 0);
    const anyKept = rows.some((r) => str(r.kept) === '1');
    realm.replaceChildren(
      h('h3', {}, 'Realm requests'),
      h('p', { class: 'realm-note' },
        source === 'events'
          ? 'Every span, unsampled: the latest failing requests, start to end.'
          : anyKept
          ? 'Kept requests first: tail-sampled, so every span is here, start to end. Follow it down to the red one.'
          : 'Head-sampled: about 1 span in 100, picked at the start, before anyone knew how the request would end. Where a span’s parent wasn’t picked, the rest of the path is missing.'),
      ...[...traces].sort(([, a], [, b]) => score(b) - score(a)).map(([id, spans]) => {
        const byId = new Map(spans.map((sp) => [str(sp.span_id), sp]));
        const depth = (sp: Row) => {
          let d = 0;
          for (let p = byId.get(str(sp.parent)); p; p = byId.get(str(p.parent))) d++;
          return d;
        };
        const kept = spans.some((sp) => str(sp.kept) === '1');
        const head = `${str(spans[0].request)} · trace ${id.slice(0, 8)} · ${kept ? 'kept (sampling.priority = 1)' : `${spans.length} span${spans.length === 1 ? '' : 's'}`}`;
        return h('div', { class: `realm-trace${kept ? ' kept' : ''}` },
          h('p', { class: 'realm-head' }, head),
          h('ol', {}, ...spans.map((sp) => {
            const err = str(sp.status) === 'error';
            const orphan = str(sp.parent) && !byId.has(str(sp.parent));
            return h('li', { class: err ? 'error' : undefined, style: `--depth: ${depth(sp)}` },
              h('span', { class: 'realm-svc' }, str(sp.service)),
              h('span', { class: 'realm-bar' }, h('i', { style: `width: ${Math.max(1.5, (num(sp.ms) / max) * 100)}%` })),
              h('span', { class: 'realm-ms' }, `${dur(num(sp.ms))}${err ? ' · error' : ''}${orphan ? ' · parent not sampled' : ''}`));
          })));
      }),
    );
  }

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
    const realmRows = await o.run(REALM_SQL(source));
    drawRealm(realmRows.rows ?? []);
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
type Kind = 'bar' | 'stacked' | 'stat' | 'time' | 'errors';
const METRICS_SQL = {
  bar: "SELECT character, sum(affection) AS affection FROM metrics_agg WHERE character NOT IN ('', 'realm') GROUP BY character ORDER BY affection DESC, character",
  stacked: "SELECT scene, character, sum(events) AS events FROM metrics_agg WHERE character != 'realm' GROUP BY scene, character ORDER BY scene, character",
  stat: "SELECT character, sum(events) AS events, sum(affection) AS affection FROM metrics_agg WHERE character != 'realm' GROUP BY character",
  statChoices: "SELECT count() AS choices FROM events WHERE event_type = 'choice'",
  time: "SELECT seq, ts, scene, node, character, choice_text, affection_delta, time_to_choose_ms FROM events WHERE event_type = 'choice' ORDER BY seq",
  /** The incident, as Metrics sees it: one number per minute, going up. */
  errors: "SELECT toStartOfMinute(ts) AS minute, countIf(attributes['status'] = 'error') AS errors, countIf(attributes['parent_span_id'] = '') AS requests FROM events WHERE event_type = 'realm_span' GROUP BY minute ORDER BY minute",
  /** …and once he adds tier back, the same number split by it. */
  errorsByTier: "SELECT toStartOfMinute(ts) AS minute, attributes['tier'] AS tier, countIf(attributes['status'] = 'error') AS errors, countIf(attributes['parent_span_id'] = '') AS requests FROM events WHERE event_type = 'realm_span' GROUP BY minute, tier ORDER BY minute, tier",
};
const TIERS = ['onlyspans', 'pro', 'free']; // stacked bottom to top: the one that matters sits on the axis
const CHART_IDLE_CAP = 5 * 60_000;
const PILLARS = ['logs', 'metrics', 'traces'];

function metricsView(o: Opts, panel: HTMLElement, openInTrace: (seq: number) => void) {
  let kind: Kind = 'bar';
  let picked = false; // until the player picks a chart, an incident opens on errors
  let rows: Row[] = [];
  let extra: Row[] = [];
  let drawnWidth = 0;

  const kinds = seg(
    [['bar', 'bar'], ['stacked', 'stacked'], ['stat', 'stat'], ['time', 'over time'], ['errors', 'errors']],
    'Chart type',
    (v) => {
      kind = v as Kind;
      picked = true;
      void refresh();
    },
  );
  const note = h('p', { class: 'viz-note', hidden: '' });
  const status = statusLine();
  const host = h('div', { class: 'chart', id: 'metrics-chart' });
  const numbers = h('details', { class: 'viz-table' });
  panel.append(h('div', { class: 'viz-controls' }, kinds.el), note, host, numbers, status.el);
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
    const data = rows.map((r) => ({ id: str(r.character), v: num(r.affection), ...who(o, str(r.character)) }));
    const unit = 'affection';
    const fmtv = signed;
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
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Affection by character, sum(affection) from metrics_agg: ${data.map((d) => `${d.name} ${signed(d.v)}`).join(', ')}.` });
    const tip = tooltip(host);
    svg.append(s('line', { class: 'zero', x1: x(0), x2: x(0), y1: 2, y2: H - 4 }));
    data.forEach((d, i) => {
      const y = i * rowH + 4;
      const { name, color } = d;
      const g = s('g', { class: 'mark', tabindex: 0, 'aria-label': `${name}: ${fmtv(d.v)} ${unit}` });
      g.append(
        ...[
          s('rect', { class: 'hit', x: 0, y, width: W, height: rowH }),
        s('text', { class: 'label', x: 0, y: y + rowH / 2, 'dominant-baseline': 'central' }, name),
        d.v ? s('path', { class: 'fill', d: hbar(x(0), x(d.v), y + (rowH - barH) / 2, barH), style: `--c: ${color}` }) : null,
          s('text', { class: 'value', x: x(d.v) + (d.v < 0 ? -6 : 6), y: y + rowH / 2, 'dominant-baseline': 'central', 'text-anchor': d.v < 0 ? 'end' : 'start' }, fmtv(d.v)),
        ].filter((k): k is SVGElement => !!k),
      );
      wire(g, tip, () => [x(d.v), y + 6], () => [h('strong', { class: 'tip-value' }, `${fmtv(d.v)} ${unit}`), h('span', {}, `${name} · sum(affection)`)]);
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

  /**
   * Errors per minute, and under them requests per minute: one column each until tier is back,
   * then stacked by tier. In the requests, free and pro thin out and stop: citizens sampled out.
   */
  function errorsChart(W: number) {
    if (!rows.length) return empty('No incident. Metrics would like it to stay that way.');
    host.replaceChildren(...perMinute(W, 'errors'), ...perMinute(W, 'requests'));
  }

  function perMinute(W: number, col: 'errors' | 'requests'): Node[] {
    const noun = col.slice(0, -1);
    const all = `all ${col}`;
    const split = rows.some((r) => r.tier !== undefined);
    const minutes = [...new Set(rows.map((r) => str(r.minute)))].sort();
    const tiers = split ? [...new Set(rows.map((r) => str(r.tier)))].sort((a, b) => (TIERS.indexOf(a) + 1 || 9) - (TIERS.indexOf(b) + 1 || 9)) : [all];
    const at = new Map(rows.map((r) => [`${str(r.minute)}|${split ? str(r.tier) : all}`, num(r[col])]));
    const val = (mi: string, t: string) => at.get(`${mi}|${t}`) ?? 0;
    const color = (t: string) => (t === 'onlyspans' ? who(o, 'collector').color : t === 'pro' ? 'var(--lilac-deep)' : t === 'free' ? '#b8aecb' : col === 'errors' ? '#e8566b' : 'var(--lilac-deep)');
    const totals = tiers.map((t) => ({ t, n: minutes.reduce((a, mi) => a + val(mi, t), 0) }));
    const hm = (mi: string) => clock(parseTs(mi)).slice(0, 5);

    const m = { l: 36, r: 8, t: 12, b: 28 };
    const H = W < 460 ? 200 : 240;
    const max = Math.max(1, ...minutes.map((mi) => tiers.reduce((a, t) => a + val(mi, t), 0)));
    const step = Math.max(1, niceStep(max, 4));
    const hi = Math.ceil(max / step) * step;
    const bw = (W - m.l - m.r) / minutes.length;
    const y = (v: number) => m.t + (1 - v / hi) * (H - m.t - m.b);
    const svg = s('svg', {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group',
      'aria-label': `${col[0].toUpperCase()}${col.slice(1)} per minute${split ? ' by tier' : ''}, from events, ${hm(minutes[0])} to ${hm(minutes.at(-1)!)}. Totals: ${totals.map((x) => `${x.t} ${x.n}`).join(', ')}.`,
    });
    for (let v = 0; v <= hi; v += step)
      svg.append(s('line', { class: v ? 'grid' : 'zero', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'tick', x: m.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'central' }, String(v)));
    const every = Math.ceil(minutes.length / (W < 460 ? 4 : 7));
    const tip = tooltip(host);
    minutes.forEach((mi, i) => {
      const x0 = m.l + i * bw + 1.5;
      const w = Math.max(1, bw - 3);
      const total = tiers.reduce((a, t) => a + val(mi, t), 0);
      const parts = tiers.filter((t) => val(mi, t));
      const g = s('g', { class: 'mark', tabindex: 0, 'aria-label': `${hm(mi)}: ${total} ${col}${split ? `, ${parts.map((t) => `${t} ${val(mi, t)}`).join(', ')}` : ''}` });
      g.append(s('rect', { class: 'hit', x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - m.b }));
      let acc = 0;
      for (const t of parts) {
        const v = val(mi, t);
        g.append(s('rect', { class: 'fill', x: x0, y: y(acc + v), width: w, height: y(acc) - y(acc + v), rx: Math.min(3, w / 2), style: `--c: ${color(t)}` }));
        acc += v;
      }
      wire(g, tip, () => [x0 + w / 2, y(total)], () => [
        h('strong', { class: 'tip-value' }, `${total} ${noun}${total === 1 ? '' : 's'}`),
        h('span', {}, `${hm(mi)} · ${col === 'errors' ? "countIf(status = 'error')" : 'requests started'}`),
        ...(split ? parts.map((t) => h('span', { class: 'tip-who' }, h('i', { class: 'key', style: `--c: ${color(t)}`, 'aria-hidden': 'true' }), `${t}: ${val(mi, t)}`)) : []),
      ]);
      svg.append(g);
      if (i % every === 0) svg.append(s('text', { class: 'tick', x: x0 + w / 2, y: H - 8, 'text-anchor': i ? 'middle' : 'start' }, hm(mi)));
    });
    const legend = h('div', { class: 'viz-legend', 'aria-hidden': 'true' }, h('strong', {}, `${col} per minute`), ...totals.map(({ t, n }) => h('span', {}, h('i', { class: 'key', style: `--c: ${color(t)}` }), `${t} `, h('strong', {}, String(n)))));
    return [legend, svg, tip.el];
  }

  function draw() {
    const W = host.clientWidth;
    if (!W) return;
    drawnWidth = W;
    if (kind === 'bar') barChart(W);
    else if (kind === 'stacked') stackedChart(W);
    else if (kind === 'stat') statTiles();
    else if (kind === 'errors') errorsChart(W);
    else timeChart(W);
  }

  async function refresh() {
    const cf = o.caseFile();
    if (!picked) kind = cf.active ? 'errors' : 'bar';
    kinds.set(kind);
    note.hidden = kind === 'bar' || kind === 'stacked';
    note.textContent =
      kind === 'errors'
        ? cf.labelBack
          ? 'Errors per minute, split by tier: the label Metrics dropped to save memory, and just added back. Under them, requests per minute: watch free and pro. It reads events, the only place tier survived.'
          : 'Errors per minute, from events. Metrics dropped tier with the rest of his labels, so this is all he’s got: one number, going up.'
        : kind === 'time'
        ? 'Over time and its exemplars read events, the whole table: metrics_agg only keeps totals, so Metrics can’t remember when anything happened.'
        : 'Choices are counted from events: metrics_agg keeps totals per character and scene, not what kind of moment each one was.';
    const r = await load(o, host, status, kind === 'errors' && cf.labelBack ? METRICS_SQL.errorsByTier : METRICS_SQL[kind]);
    if (!r) return;
    rows = r;
    extra = kind === 'stat' ? ((await o.run(METRICS_SQL.statChoices)).rows ?? []) : [];
    numbers.replaceChildren(h('summary', {}, 'show the numbers'), o.table(rows, 200));
    numbers.hidden = kind === 'stat';
    draw();
  }

  return { refresh };
}

// ---------- Wide event deltas: box what looks wrong, see what's different about it ----------
// The wide table's own view. A heatmap of every Realm span (minute by duration); select a region
// and each attribute is compared inside the selection against everything outside it. The ones
// whose values differ most come first. The selection is bin indexes, so only numbers reach the SQL.
const WD_DIMS = ['tier', 'service', 'status', 'request', 'subscriber_id'];
/** Two buckets per power of ten: 0 is 1 ms, 6 is 1 s, 8 is 10 s. */
const WD_BUCKET = "toUInt8(floor(2 * log10(greatest(toFloat64OrZero(attributes['duration_ms']), 1))))";
const WD_SLOW = 6;
const WD_HEAT = `SELECT toStartOfMinute(ts) AS minute, ${WD_BUCKET} AS bucket, count() AS spans FROM events WHERE event_type = 'realm_span' GROUP BY minute, bucket ORDER BY minute, bucket`;
const WD_COMPARE = (from: string, to: string, b0: number, b1: number) =>
  `SELECT tupleElement(kv, 1) AS attribute, tupleElement(kv, 2) AS value, countIf(sel) AS selected, countIf(NOT sel) AS baseline FROM (SELECT arrayJoin([${WD_DIMS.map((d) => `('${d}', attributes['${d}'])`).join(', ')}]) AS kv, (ts >= '${from}' AND ts < '${to}' AND ${WD_BUCKET} BETWEEN ${b0} AND ${b1}) AS sel FROM events WHERE event_type = 'realm_span') GROUP BY attribute, value ORDER BY attribute = 'subscriber_id', attribute, selected DESC, baseline DESC LIMIT ${ROW_LIMIT - 1}`;
const sqlTs = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function deltasView(o: Opts, panel: HTMLElement) {
  type Sel = { m0: number; m1: number; b0: number; b1: number }; // inclusive bin indexes
  let heat: Row[] = [];
  let minutes: string[] = [];
  let top = 9;
  let sel: Sel | undefined;
  let drawnWidth = 0;

  const slow = h('button', { type: 'button', class: 'viz-btn', id: 'wd-slow' }, 'select the slow ones');
  const clear = h('button', { type: 'button', class: 'viz-btn', id: 'wd-clear' }, 'clear');
  const status = statusLine();
  const host = h('div', { class: 'chart wd-heat', id: 'wd-heat' });
  const out = h('div', { class: 'wd-dims', id: 'wd-dims', 'aria-live': 'polite' });
  panel.append(
    h('p', { class: 'viz-note' }, 'Every span the Realm wrote, from events: when, and how long it took. Drag a box round what looks wrong. The attributes that differ most between the box and everything else come first.'),
    h('div', { class: 'viz-segs' }, slow, clear),
    host, out, status.el,
  );
  slow.onclick = () => pick({ m0: 0, m1: minutes.length - 1, b0: WD_SLOW, b1: top });
  clear.onclick = () => pick(undefined);

  const label = (b: number) => dur(10 ** (b / 2));
  function pick(next: Sel | undefined) {
    sel = next;
    draw();
    void compare();
  }

  function draw() {
    const W = host.clientWidth;
    if (!W) return;
    drawnWidth = W;
    if (!minutes.length) return host.replaceChildren(h('p', { class: 'viz-empty' }, 'Nothing to compare. The Realm is quiet, and the wide table would like it noted that it was ready anyway.'));
    const m = { l: 44, r: 8, t: 8, b: 26 };
    const ch = 18;
    const H = m.t + (top + 1) * ch + m.b;
    const cw = (W - m.l - m.r) / minutes.length;
    const max = Math.max(1, ...heat.map((r) => num(r.spans)));
    const hm = (mi: string) => clock(parseTs(mi)).slice(0, 5);
    const total = heat.reduce((a, r) => a + num(r.spans), 0);
    const slowN = heat.filter((r) => num(r.bucket) >= WD_SLOW).reduce((a, r) => a + num(r.spans), 0);
    const svg = s('svg', {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `Span durations by minute, from events, ${hm(minutes[0])} to ${hm(minutes.at(-1)!)}. ${total} spans, ${slowN} of them slower than ${label(WD_SLOW)}.`,
    });
    for (let b = 0; b <= top; b += 2) svg.append(s('text', { class: 'tick', x: m.l - 8, y: m.t + (top - b + 1) * ch, 'text-anchor': 'end', 'dominant-baseline': 'central' }, label(b)));
    const every = Math.ceil(minutes.length / (W < 460 ? 4 : 7));
    minutes.forEach((mi, i) => {
      if (i % every === 0) svg.append(s('text', { class: 'tick', x: m.l + i * cw + cw / 2, y: H - 8, 'text-anchor': i ? 'middle' : 'start' }, hm(mi)));
    });
    for (const r of heat) {
      const i = minutes.indexOf(str(r.minute));
      const b = Math.min(num(r.bucket), top);
      svg.append(s('rect', { class: 'wd-cell', x: m.l + i * cw + 1, y: m.t + (top - b) * ch + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 3, 'fill-opacity': (0.18 + 0.82 * Math.sqrt(num(r.spans) / max)).toFixed(2) }));
    }
    const box = s('rect', { class: 'wd-sel', rx: 4 });
    const place = (x: Sel | undefined) => {
      if (!x) return box.setAttribute('visibility', 'hidden');
      box.setAttribute('visibility', 'visible');
      for (const [k, v] of Object.entries({ x: m.l + x.m0 * cw, y: m.t + (top - x.b1) * ch, width: (x.m1 - x.m0 + 1) * cw, height: (x.b1 - x.b0 + 1) * ch })) box.setAttribute(k, String(v));
    };
    place(sel);
    svg.append(box);

    // Drag from one bin to another; the box snaps to whole bins.
    const bin = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const k = W / r.width;
      const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.floor(v)));
      return { mi: clamp(((e.clientX - r.left) * k - m.l) / cw, minutes.length - 1), b: top - clamp(((e.clientY - r.top) * k - m.t) / ch, top) };
    };
    let from: { mi: number; b: number } | undefined;
    let drag: Sel | undefined;
    const span = (e: PointerEvent): Sel => {
      const to = bin(e);
      return { m0: Math.min(from!.mi, to.mi), m1: Math.max(from!.mi, to.mi), b0: Math.min(from!.b, to.b), b1: Math.max(from!.b, to.b) };
    };
    svg.addEventListener('pointerdown', (e) => {
      from = bin(e);
      svg.setPointerCapture(e.pointerId);
      place((drag = span(e)));
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => from && place((drag = span(e))));
    const end = () => {
      if (!from) return;
      from = undefined;
      pick(drag);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    host.replaceChildren(svg);
  }

  async function compare() {
    if (!sel) {
      status.set('', '');
      return out.replaceChildren(h('p', { class: 'viz-empty' }, minutes.length ? 'No selection yet. Most of this is quick. What isn’t?' : ''));
    }
    const from = parseTs(minutes[sel.m0]);
    const rows = await load(o, out, status, WD_COMPARE(sqlTs(from), sqlTs(parseTs(minutes[sel.m1]) + 60_000), sel.b0, sel.b1));
    if (!rows) return;
    const dims = WD_DIMS.map((name) => {
      const vals = rows.filter((r) => str(r.attribute) === name).map((r) => ({ v: str(r.value), s: num(r.selected), b: num(r.baseline) }));
      const S = vals.reduce((a, x) => a + x.s, 0);
      const B = vals.reduce((a, x) => a + x.b, 0);
      const share = vals.map((x) => ({ v: x.v, s: S ? x.s / S : 0, b: B ? x.b / B : 0 }));
      // Half the summed gap between the two distributions: 0 is identical, 1 is nothing in common.
      const score = share.reduce((a, x) => a + Math.abs(x.s - x.b), 0) / 2;
      const distinct = vals.filter((x) => x.s).length;
      return { name, S, share: share.sort((a, b) => Math.max(b.s, b.b) - Math.max(a.s, a.b)).slice(0, 5), score, distinct };
    });
    const S = dims[0]?.S ?? 0;
    if (!S) return out.replaceChildren(h('p', { class: 'viz-empty' }, 'Nothing in that box. Try the dark band at the top.'));
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    out.replaceChildren(
      h('p', { class: 'viz-legend' }, h('strong', {}, `${S} spans selected`), h('span', {}, h('i', { class: 'key', style: '--c: var(--wd-sel)' }), 'in the box'), h('span', {}, h('i', { class: 'key', style: '--c: var(--wd-base)' }), 'everything else')),
      ...dims.sort((a, b) => b.score - a.score).map((d) =>
        h('section', { class: 'wd-dim', 'data-attribute': d.name },
          h('h3', {}, d.name, h('span', { class: 'wd-score' }, `differs ${pct(d.score)}`)),
          d.distinct > 5 && d.distinct > d.S / 2 ? h('p', { class: 'wd-uniq' }, `${d.distinct} different values across ${d.S} selected spans: nearly every one has its own.`) : null,
          h('ul', {}, ...d.share.map((x) =>
            h('li', { 'aria-label': `${x.v || 'none'}: ${pct(x.s)} of the selection, ${pct(x.b)} of everything else` },
              h('span', { class: 'wd-val' }, x.v || '(none)'),
              h('span', { class: 'wd-bars', 'aria-hidden': 'true' }, h('i', { class: 'wd-s', style: `width: ${x.s * 100}%` }), h('i', { class: 'wd-b', style: `width: ${x.b * 100}%` })),
              h('span', { class: 'wd-pct', 'aria-hidden': 'true' }, `${pct(x.s)} · ${pct(x.b)}`),
            ))),
        )),
    );
  }

  async function refresh() {
    const rows = await load(o, host, status, WD_HEAT);
    if (!rows) return;
    heat = rows;
    minutes = [...new Set(rows.map((r) => str(r.minute)))].sort();
    top = Math.max(9, ...rows.map((r) => num(r.bucket)));
    if (sel && sel.m1 >= minutes.length) sel = undefined;
    draw();
    await compare();
  }
  new ResizeObserver(() => host.clientWidth && host.clientWidth !== drawnWidth && draw()).observe(host);

  return { refresh };
}
