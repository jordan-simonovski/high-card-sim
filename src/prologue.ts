// Placeholder prologue (M1). Moves to YAML content in M2/M3. Everything before `listening`
// runs without the query engine, so it covers the engine download.
import type { Scene } from './engine/scene.ts';

export const prologue: Scene = {
  id: 'prologue',
  start: 'ceiling',
  nodes: {
    ceiling: { id: 'ceiling', text: '03:12. Your phone lights up the ceiling.', next: 'page' },
    page: { id: 'page', speaker: 'pager', text: 'CRITICAL: checkout p99 is… yes. All of it. Everything is on fire.', next: 'dash' },
    dash: { id: 'dash', text: 'You open the dashboard. Every panel is green. Every panel is lying.', next: 'ack' },
    ack: {
      id: 'ack',
      text: 'Your thumb hovers.',
      choices: [
        { id: 'ack', text: 'Acknowledge the page', target: 'through' },
        { id: 'snooze', text: 'Snooze it (five minutes, tops)', target: 'tilt' },
      ],
    },
    through: { id: 'through', text: 'You tap ACK. Your thumb goes through the glass and keeps going.', next: 'ingest' },
    tilt: { id: 'tilt', text: 'You tap SNOOZE. The pager, offended, pages harder. The room tilts.', next: 'ingest' },
    ingest: { id: 'ingest', text: 'Somewhere, a collector is spinning up. You are being… ingested.', next: 'hello' },
    hello: {
      id: 'hello',
      speaker: '???',
      text: "Oh! A new span. Hi! Sorry, you're very high cardinality. It's taking a second to index you.",
      next: 'listening',
    },
    listening: {
      id: 'listening',
      text: '',
      branches: [{ condition: 'hesitated', target: 'slow' }],
      next: 'fast',
    },
    slow: { id: 'slow', speaker: '???', text: "You took your time with that page. That's okay. Someone is going to notice, though." },
    fast: { id: 'fast', speaker: '???', text: 'You acked fast. Someone is going to notice that, too.' },
  },
};
