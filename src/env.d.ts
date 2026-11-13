/** Uncompressed chdb.wasm size, injected by vite.config.ts for the loader's progress bar. */
declare const __CHDB_WASM_BYTES__: number;

declare module 'virtual:content' {
  import type { Scene } from './engine/scene.ts';
  import type { CharacterDef } from './engine/validate.ts';
  const content: {
    scenes: Record<string, Scene>;
    queries: Record<string, string>;
    characters: Record<string, CharacterDef>;
  };
  export default content;
}
