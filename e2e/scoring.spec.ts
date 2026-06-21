import { test, expect } from '@playwright/test';

// Tests pilotés par le CONTRAT /api/* (inchangé par la migration) → mocks.
const JOBS = {
  jobs: [
    {
      job_id: 'J1', titre: 'Analyste BI', entreprise: 'Santé publique', url: 'https://ex.com/1',
      score: 82, tier: 'A', priorite: 'A', deadline: '',
      date_collecte: new Date().toISOString().slice(0, 10),
      positionnement: 'Bon alignement BI/Power BI.',
      forces: ['Power BI', 'SQL'], gaps: [{ gap: 'Azure', explication: 'Cours UQAM seulement' }],
    },
    {
      job_id: 'J2', titre: "Analyste d'affaires", entreprise: 'Desjardins', url: 'https://ex.com/2',
      score: 61, tier: 'B', priorite: 'B', date_collecte: new Date().toISOString().slice(0, 10),
      forces: ['BPMN'], gaps: ['Finance'],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/jobs*', (r) => r.fulfill({ json: JOBS }));
  await page.route('**/api/briefing*', (r) => r.fulfill({ json: { error: 'none' } }));
});

test('Scoring affiche les offres scorées', async ({ page }) => {
  await page.goto('/scoring');
  await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible();
  const deck = page.getByTestId('deck');
  await expect(deck.getByText('Analyste BI')).toBeVisible();
  await expect(deck.getByText("Analyste d'affaires")).toBeVisible();
  await expect(page.getByTestId('count')).toHaveText('2');
  await expect(deck.getByText('82')).toBeVisible();
  // actions présentes sur la 1re carte
  await expect(page.getByTestId('btn-generer').first()).toBeVisible();
  await expect(page.getByTestId('btn-contester').first()).toBeVisible();
});

test('Contester ouvre la zone de commentaire', async ({ page }) => {
  await page.goto('/scoring');
  await page.getByTestId('btn-contester').first().click();
  await expect(page.getByTestId('contest-input').first()).toBeVisible();
});

test('Le tri par Score est sélectionnable', async ({ page }) => {
  await page.goto('/scoring');
  await page.getByTestId('sort-score').click();
  await expect(page.getByTestId('sort-score')).toHaveClass(/text-primary/);
});

test('Navigation entre écrans migrés', async ({ page }) => {
  await page.goto('/scoring');
  await page.getByTestId('nav-chat').click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByTestId('msg-input')).toBeVisible();
});
