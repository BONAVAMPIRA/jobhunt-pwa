import { test, expect } from '@playwright/test';

/**
 * Onglet Suivi : offres post-candidature (postulé+), prétention salariale en
 * évidence (besoin RANDSTAD), recherche. Le téléchargement (File System Access)
 * n'est pas testable headless ; on couvre rendu + glance + filtre.
 */

test.use({ serviceWorkers: 'block' });

test('suivi : cartes postulées, prétention salariale visible, recherche', async ({ page }) => {
  await page.route('**/api/suivi', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [
      { job_id: 'J1', entreprise: 'Pursuit', poste: 'BI Analyst', statut: 'postulé', score: 86,
        url: 'https://x.test/1', date: '2026-06-14', salaire_cible: '90 000 $', salaire_plancher: '80 000 $',
        docs: { cv: true, lm: true, salaire: true, guide: true } },
      { job_id: 'J2', entreprise: 'Ashling', poste: 'AI Business Analyst', statut: 'entrevue', score: 84,
        url: '', date: '', salaire_cible: '', salaire_plancher: '', docs: {} },
    ], total: 2 }),
  }));

  await page.goto('/suivi.html');

  await expect(page.locator('.card')).toHaveCount(2);
  const pursuit = page.locator('.card', { hasText: 'Pursuit' });
  await expect(pursuit).toContainText('POSTULÉ');
  await expect(pursuit).toContainText('90 000 $');           // prétention glançable
  await expect(pursuit).toContainText('80 000 $');
  await expect(page.locator('.card', { hasText: 'Ashling' })).toContainText('ENTREVUE');
  await expect(page.locator('.card', { hasText: 'Ashling' })).toContainText('non disponible'); // pas de salaire

  // recherche
  await page.locator('#search').fill('pursuit');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('Pursuit');

  // bouton dossier présent
  await expect(page.locator('.card .btn-dl')).toBeVisible();
});

test('suivi : état vide quand aucune candidature', async ({ page }) => {
  await page.route('**/api/suivi', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [], total: 0 }),
  }));
  await page.goto('/suivi.html');
  await expect(page.locator('.info-card')).toContainText('Aucune candidature suivie');
});
