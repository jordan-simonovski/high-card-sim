import { defineConfig, type Plugin } from 'vite';
import { statSync } from 'node:fs';
import { loadContent } from './scripts/content.ts';

// Cross-origin isolation: required by the multi-threaded (mt) chdb bundle.
const coi = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `import content from 'virtual:content'`: validated scenes, characters and queries.
// Any content error fails the build (and shows the dev overlay).
function content(): Plugin {
  const id = '\0virtual:content';
  return {
    name: 'content',
    resolveId: (s) => (s === 'virtual:content' ? id : undefined),
    load(s) {
      if (s !== id) return;
      const { content, errors, files } = loadContent();
      files.forEach((f) => this.addWatchFile(f));
      if (errors.length) throw new Error(`content lint failed:\n  ${errors.join('\n  ')}`);
      return `export default ${JSON.stringify(content)};`;
    },
  };
}

export default defineConfig({
  plugins: [content()],
  define: { __CHDB_WASM_BYTES__: statSync('node_modules/chdb-wasm/dist/chdb.wasm').size },
  server: { headers: coi },
  preview: { headers: coi },
});
