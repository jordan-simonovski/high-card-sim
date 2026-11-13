import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:4173' },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, timeout: 180_000, reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
  ],
});
