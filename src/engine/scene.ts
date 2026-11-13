// Deterministic scene engine. Pure TS: no DOM, no chDB. Conditions are named SQL queries
// evaluated by whoever calls in (real chDB in the game, a fake map in tests).

export interface Choice {
  id: string;
  text: string;
  target: string;
  character?: string;
  affection_delta?: number;
  /** Named query; the choice is only offered when it is truthy. */
  condition?: string;
  /** Extra span attributes on the choice event (e.g. sampling.priority: "1" keeps it in Traces' view). */
  attributes?: Record<string, string>;
  /** Visual feedback only: a good or bad call in the moment (affection deltas imply it otherwise). */
  vibe?: 'good' | 'bad';
}

export interface Branch {
  condition: string;
  target: string;
}

export interface SceneNode {
  id: string;
  speaker?: string;
  text: string;
  choices?: Choice[];
  /** Evaluated in order after the node; first truthy wins, else `next`. */
  branches?: Branch[];
  next?: string;
  /** UI step to run when the node is reached (e.g. 'create_character'), then continue to `next`. */
  action?: string;
  /** Named query whose result rows are shown as a table under the text. */
  show?: string;
  /** Ending title. An ending node is terminal. */
  ending?: string;
  /** Speaker expression (content/assets.yaml moods). */
  mood?: string;
  /** Background override; otherwise the scene's bg carries on. */
  bg?: string;
  /** Full-screen illustration shown with this node. */
  cg?: string;
  /** Change the music from this node on ("none" for silence). */
  music?: string;
  /** One-shot sound effect when the node is shown. */
  sfx?: string;
}

export interface Scene {
  id: string;
  start: string;
  bg?: string;
  music?: string;
  nodes: Record<string, SceneNode>;
}

/** Targets starting with '@' jump to another scene's start node: '@hub'. */
export const sceneTarget = (target: string): string | undefined => (target.startsWith('@') ? target.slice(1) : undefined);

/** Evaluates a named query to a boolean. */
export type Conditions = (queryName: string) => Promise<boolean>;

export function node(scene: Scene, id: string): SceneNode {
  const n = scene.nodes[id];
  if (!n) throw new Error(`scene ${scene.id}: unknown node ${id}`);
  return n;
}

/** True when showing or leaving this node needs the query engine. */
export function needsQueries(n: SceneNode): boolean {
  return !!n.branches?.length || !!n.show || !!n.choices?.some((c) => c.condition);
}

/** Choices to offer, in authored order. Conditions run sequentially (deterministic). */
export async function visibleChoices(n: SceneNode, cond: Conditions): Promise<Choice[]> {
  const out: Choice[] = [];
  for (const c of n.choices ?? []) if (!c.condition || (await cond(c.condition))) out.push(c);
  return out;
}

/** Id of the node that follows `n`. `choiceId` is required when the node has choices. */
export async function nextNode(n: SceneNode, cond: Conditions, choiceId?: string): Promise<string | undefined> {
  if (n.choices?.length) {
    const c = n.choices.find((x) => x.id === choiceId);
    if (!c) throw new Error(`node ${n.id}: unknown choice ${String(choiceId)}`);
    return c.target;
  }
  for (const b of n.branches ?? []) if (await cond(b.condition)) return b.target;
  return n.next; // undefined = end of scene
}
