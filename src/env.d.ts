declare module 'virtual:content' {
  import type { Scene } from './engine/scene.ts';
  import type { CharacterDef } from './engine/validate.ts';
  const content: {
    assets: { moods: string[]; backgrounds: Record<string, string>; cgs: Record<string, string>; music: Record<string, string>; sfx: Record<string, unknown>; babble: Record<string, string> };
    scenes: Record<string, Scene>;
    queries: Record<string, string>;
    characters: Record<string, CharacterDef>;
  };
  export default content;
}
