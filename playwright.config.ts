import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke tests pour la PWA JobHunt (site statique multi-pages, déployé sur Vercel).
 * BASE_URL : pointe par défaut sur le serveur statique local (npm run serve).
 *   - Local  : BASE_URL non défini → http://localhost:3000 (webServer démarre `serve` tout seul)
 *   - Preview/prod : BASE_URL=https://<preview>.vercel.app npm run test:e2e (webServer ignoré)
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  // Série + 1 worker : le test d'extension tourne en mode *headed* (Chromium ne
  // charge les extensions qu'en tête) et vole le focus OS, ce qui fait flaker les
  // tests headless lancés en parallèle (selectOption/click). On sérialise.
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
  // Démarre le serveur statique local uniquement quand on teste en local.
  webServer: useLocalServer
    ? {
        command: 'npm run serve',
        url: BASE_URL,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
