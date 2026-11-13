import { defineConfig } from 'vite';
import { statSync } from 'node:fs';

// Cross-origin isolation: required by the multi-threaded (mt) chdb bundle.
const coi = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  define: { __CHDB_WASM_BYTES__: statSync('node_modules/chdb-wasm/dist/chdb.wasm').size },
  server: { headers: coi },
  preview: { headers: coi },
});
