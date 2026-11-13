// Loads and validates content/ (scenes YAML, characters YAML, queries SQL). Used by the
// Vite plugin (build fails on errors) and by `npm run lint:content`.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { validate, type CharacterDef } from '../src/engine/validate.ts';
import { PRESETS } from '../src/engine/pronouns.ts';
import type { Scene, SceneNode } from '../src/engine/scene.ts';

export interface Assets {
  moods: string[];
  backgrounds: Record<string, string>;
  cgs: Record<string, string>;
}

export interface LoadedContent {
  assets: Assets;
  scenes: Record<string, Scene>;
  queries: Record<string, string>;
  characters: Record<string, CharacterDef>;
}

const ls = (dir: string, ext: string) =>
  readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => join(dir, f));

export function loadContent(root = 'content'): { content: LoadedContent; errors: string[]; files: string[] } {
  const errors: string[] = [];
  const sceneFiles = ls(join(root, 'scenes'), '.yaml');
  const queryFiles = ls(join(root, 'queries'), '.sql');
  const charFile = join(root, 'characters.yaml');
  const assetFile = join(root, 'assets.yaml');
  const assets = parse(readFileSync(assetFile, 'utf8')) as Assets;

  const scenes: Record<string, Scene> = {};
  for (const f of sceneFiles) {
    try {
      const raw = parse(readFileSync(f, 'utf8')) as { id: string; start: string; bg?: string; nodes: Record<string, Omit<SceneNode, 'id'>> };
      if (raw.id !== basename(f, '.yaml')) errors.push(`${f}: id "${raw.id}" must match the file name`);
      const nodes = Object.fromEntries(Object.entries(raw.nodes ?? {}).map(([id, n]) => [id, { ...n, id }]));
      scenes[raw.id] = { id: raw.id, start: raw.start, bg: raw.bg, nodes };
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  const queries = Object.fromEntries(queryFiles.map((f) => [basename(f, '.sql'), readFileSync(f, 'utf8')]));
  const characters = (parse(readFileSync(charFile, 'utf8')) ?? {}) as Record<string, CharacterDef>;

  errors.push(
    ...validate({
      scenes: Object.values(scenes), queries: Object.keys(queries), characters, presets: Object.keys(PRESETS),
      assets: { moods: assets.moods, backgrounds: Object.keys(assets.backgrounds), cgs: Object.keys(assets.cgs) },
    }),
  );
  return { content: { assets, scenes, queries, characters }, errors, files: [...sceneFiles, ...queryFiles, charFile, assetFile] };
}
