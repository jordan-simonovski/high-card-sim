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
}

export interface Scene {
  id: string;
  start: string;
  nodes: Record<string, SceneNode>;
}

/** Evaluates a named query to a boolean. */
export type Conditions = (queryName: string) => Promise<boolean>;

export function node(scene: Scene, id: string): SceneNode {
  const n = scene.nodes[id];
  if (!n) throw new Error(`scene ${scene.id}: unknown node ${id}`);
  return n;
}

/** True when showing or leaving this node needs the query engine. */
export function needsQueries(n: SceneNode): boolean {
  return !!n.branches?.length || !!n.choices?.some((c) => c.condition);
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
