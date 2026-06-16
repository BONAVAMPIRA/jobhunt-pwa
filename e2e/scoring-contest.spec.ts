import { test, expect } from '@playwright/test';

/**
 * Vérifie la contestation/re-scoring ASYNC :
 *   Contester → commentaire → /api/rescore (réponse immédiate {pending}) →
 *   polling /api/rescore-result → quand prêt, la carte affiche « Score révisé ».
 * Mocke /api/jobs, /api/briefing, /api/rescore et /api/rescore-result.
 */

test.use({ serviceWorkers: 'block' });

const JOB = {
  job_id: 'J-TEST-1', titre: 'Analyste BI', entreprise: 'ACME',
  score: 62, tier: 'B', priorite: 'B', forces: ['Power BI'], gaps: ['DAX avancé'],
  deadline: '', date_collecte: '2026-06-10', positionnement: 'Bon fit BI.',
  recommandation: '',
};

test('contestation async : la carte affiche le score révisé après polling', async ({ page }) => {
  await page.route('**/api/jobs', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [JOB], total: 1 }) }));
  await page.route('**/api/briefing', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/rescore', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pending: true, job_id: 'J-TEST-1' }) }));

  // 1er appel résultat = pas prêt, puis prêt avec un score révisé.
  let polls = 0;
  await page.route('**/api/rescore-result**', r => {
    polls++;
    const body = polls < 2
      ? { ready: false, pending: true }
      : { ready: true, result: { score: 81, positionnement: 'Révisé : très bon fit.', gaps_json: JSON.stringify(['Snowflake']) } };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/scoring.html');

  // La carte s'affiche
  const card = page.locator('.card', { hasText: 'Analyste BI' });
  await expect(card).toBeVisible();

  // Contester → écrire un commentaire → Re-scorer
  await card.getByRole('button', { name: /Contester/ }).click();
  await card.locator('textarea').fill('Mon expérience DAX n\'est pas comptée.');
  await card.getByRole('button', { name: /Re-scorer/ }).click();

  // Après le polling, la carte (remplacée) affiche le score révisé
  const revised = page.locator('.card', { hasText: 'Score révisé' });
  await expect(revised).toBeVisible({ timeout: 15000 });
  await expect(revised).toContainText('62 → 81');
});

test('badge de tier : la carte affiche le tier A/B/C', async ({ page }) => {
  await page.route('**/api/jobs', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [JOB], total: 1 }) }));
  await page.route('**/api/briefing', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/scoring.html');
  const card = page.locator('.card', { hasText: 'Analyste BI' });
  await expect(card.locator('.tier-badge.tier-b')).toBeVisible();
  await expect(card.locator('.tier-badge')).toContainText('entrée');
});
