import { defineConfig } from 'vite';

// Cross-origin isolation: required by the multi-threaded (mt) chdb bundle.
const coi = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: coi },
  preview: { headers: coi },
});
