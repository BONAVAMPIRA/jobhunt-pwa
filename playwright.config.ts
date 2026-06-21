import { defineConfig, devices } from '@playwright/test';

/**
 * E2E pour la PWA JobHunt (migrée Vite + React, skill pwa-moderne).
 * BASE_URL : par défaut le preview Vite local (npm run preview sert dist/).
 *   - Local  : BASE_URL non défini → http://localhost:3000 (webServer démarre `npm run preview`)
 *   - Preview/prod : BASE_URL=https://<preview>.vercel.app npm run test:e2e (webServer ignoré)
 * Les specs de l'ancien site statique sont sous e2e/legacy/ (ignorées, à réécrire au fil de la migration).
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/legacy/**',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: useLocalServer
    ? {
        command: 'npm run preview',
        url: BASE_URL,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
