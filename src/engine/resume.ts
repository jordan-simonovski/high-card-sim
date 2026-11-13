// Where to pick the story back up, derived from the event log alone. Pure TS.
import { sceneTarget, type Scene } from './scene.ts';

export interface ResumeEvent {
  event_type: string;
  scene: string;
  node: string;
  choice_id: string;
}

export interface ResumePoint {
  scene: string;
  node: string;
  /** The node's line is already in the log: show it, don't log it again. */
  shown: boolean;
}

const RELEVANT = new Set(['line', 'choice', 'scene_enter', 'character_created', 'ending']);

/** undefined = nothing to resume (new game, or the story already ended). */
export function resumePoint(events: ResumeEvent[], scenes: Record<string, Scene>): ResumePoint | undefined {
  const e = events.findLast((x) => RELEVANT.has(x.event_type));
  if (!e || e.event_type === 'ending') return undefined;
  const scene = scenes[e.scene];
  const n = scene?.nodes[e.node];
  if (!scene || !n) return undefined; // content changed under an old save
  const go = (target: string | undefined): ResumePoint | undefined => {
    if (!target) return undefined;
    const other = sceneTarget(target);
    if (other) return scenes[other] ? { scene: other, node: scenes[other].start, shown: false } : undefined;
    return { scene: scene.id, node: target, shown: false };
  };
  switch (e.event_type) {
    case 'choice':
      return go(n.choices?.find((c) => c.id === e.choice_id)?.target);
    case 'character_created':
      return go(n.next);
    case 'scene_enter':
      return { scene: scene.id, node: scene.start, shown: false };
    default:
      return { scene: scene.id, node: n.id, shown: true };
  }
}
