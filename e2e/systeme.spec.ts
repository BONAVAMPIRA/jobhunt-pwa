import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config*', (r) => r.fulfill({ json: { search_terms: 'analyste BI, business analyst', location: 'Montréal, QC' } }));
  await page.route('**/api/services*', (r) => r.fulfill({ json: { 'n8n-jobhunt': 'active', 'cockpit-api': 'active' } }));
  await page.route('**/api/crons*', (r) => r.fulfill({ json: { crons: [{ id: 1, name: 'Scoring horaire', schedule: '0 * * * *' }] } }));
});

test('Système affiche la config (avec aide) et les services', async ({ page }) => {
  await page.goto('/systeme');
  await expect(page.getByText('CONFIGURATION DE LA COLLECTE')).toBeVisible();
  await expect(page.getByText('Mots-clés recherchés')).toBeVisible();
  await expect(page.getByText('Moteur de workflows (n8n)')).toBeVisible();
  await expect(page.getByText('● Actif').first()).toBeVisible();
});

test('Les crons sont enterrés sous « Avancé » (audit UX)', async ({ page }) => {
  await page.goto('/systeme');
  // caché par défaut (details fermé)
  await expect(page.getByText('Scoring horaire')).toBeHidden();
  await page.getByText(/Avancé — tâches planifiées/).click();
  await expect(page.getByText('Scoring horaire')).toBeVisible();
});
