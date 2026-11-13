// The Sev-1 case file: what's been found so far and what to look for next, derived from the event
// log alone (never SQL, so peeking at it can't count as a base-table query). Pure TS, no DOM.
import type { GameEvent } from './eventlog.ts';
import type { View } from './viz.ts';

export interface Lead {
  id: 'logs' | 'metrics' | 'traces' | 'wide';
  who: string; // character id, for the colour
  title: string;
  /** Which shell tab this lead is worked in. */
  tab: View;
  look: string; // the hint while it's the current lead
  clue: string; // what it says once found
  state: 'found' | 'current' | 'locked';
}

// A lead is found once its scene reaches the node where the pillar names the clue.
const LEADS: (Omit<Lead, 'state'> & { scene: string; node: string })[] = [
  {
    id: 'logs', who: 'logs', title: 'Logs: read everything', tab: 'logs', scene: 'phase_logs', node: 'source',
    look: 'Everyone searches for ERROR. Filter to WARN, or group the lines into patterns, and look for the one she keeps repeating.',
    clue: 'WARN from service metrics, over and over: cardinality limit exceeded, dropping series {attribute=subscriber_id}',
  },
  {
    id: 'metrics', who: 'metrics', title: 'Metrics: add the dimension back', tab: 'metrics', scene: 'phase_metrics', node: 'clue',
    look: 'Errors per minute. Once tier is back, look for the colour doing nearly all the climbing.',
    clue: 'Nearly every error is tier = onlyspans, the Collector’s premium tier',
  },
  {
    id: 'traces', who: 'traces', title: 'Traces: keep the moment that matters', tab: 'trace', scene: 'phase_traces', node: 'every_span',
    look: 'Realm requests are at the top. Find the kept one and follow it down to the red span.',
    clue: 'The failing request dies in collector.batch_processor: 30 s, then deadline exceeded',
  },
  {
    id: 'wide', who: 'dba', title: 'The wide event: root cause', tab: 'deltas', scene: 'root_cause', node: 'explain',
    look: 'Open Deltas and box the slow band at the top (or press “select the slow ones”). Read which attributes differ most from everything else.',
    clue: 'OnlySpans stamps a new subscriber_id on every span, and the Collector sends it to Metrics as a label: a new series per span. The wide table never minded.',
  },
];

export interface CaseFile {
  /** Declared and not yet resolved. */
  active: boolean;
  resolved: boolean;
  leads: Lead[];
  current?: Lead;
  /** Metrics has added tier back, so the error chart can split by it. */
  labelBack: boolean;
}

export function caseFile(events: GameEvent[]): CaseFile {
  const has = (type: string) => events.some((e) => e.event_type === type);
  const reached = (scene: string, node: string) => events.some((e) => e.scene === scene && e.node === node && e.event_type === 'line');
  let current: Lead | undefined;
  const leads = LEADS.map(({ scene, node, ...l }): Lead => {
    if (reached(scene, node)) return { ...l, state: 'found' };
    if (current) return { ...l, state: 'locked' };
    return (current = { ...l, state: 'current' });
  });
  const resolved = has('incident_resolved');
  return {
    active: has('incident_started') && !resolved,
    resolved,
    leads,
    current: resolved ? undefined : current,
    labelBack: reached('phase_metrics', 'add') || leads[1].state === 'found',
  };
}
