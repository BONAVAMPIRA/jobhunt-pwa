import { test, expect } from '@playwright/test';

const SUIVI = {
  jobs: [
    { job_id: 'A1', statut: 'postulé', tier: 'A', score: 82, poste: 'Analyste BI', entreprise: 'Loto-Québec', url: 'https://ex.com/a', salaire_cible: '85 000 $', salaire_plancher: '78 000 $', date: '2026-06-15' },
    { job_id: 'A2', statut: 'entrevue', poste: "Analyste d'affaires", entreprise: 'Hydro-Québec', date: '2026-06-10' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/suivi*', (r) => r.fulfill({ json: SUIVI }));
});

test('Suivi liste les candidatures avec statut et prétention salariale', async ({ page }) => {
  await page.goto('/suivi');
  await expect(page.getByRole('heading', { name: 'Suivi' })).toBeVisible();
  await expect(page.getByText('Analyste BI')).toBeVisible();
  await expect(page.getByText('POSTULÉ')).toBeVisible();
  await expect(page.getByText('ENTREVUE')).toBeVisible();
  await expect(page.getByText('85 000 $')).toBeVisible();
  await expect(page.getByTestId('btn-dossier').first()).toBeVisible();
});

test('La recherche filtre les candidatures', async ({ page }) => {
  await page.goto('/suivi');
  await page.getByPlaceholder(/Rechercher/).fill('Hydro');
  await expect(page.getByText("Analyste d'affaires")).toBeVisible();
  await expect(page.getByText('Analyste BI')).toHaveCount(0);
});
