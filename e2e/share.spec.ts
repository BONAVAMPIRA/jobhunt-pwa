import { test, expect } from '@playwright/test';

test('Share auto-extrait les champs depuis /api/process', async ({ page }) => {
  await page.route('**/api/process*', (r) => r.fulfill({ json: { poste: 'Analyste BI', entreprise: 'Loto-Québec', mission: 'Tableaux de bord Power BI' } }));
  await page.goto('/share?url=https://www.linkedin.com/jobs/view/123');
  await expect(page.getByTestId('f-poste')).toHaveValue('Analyste BI');
  await expect(page.getByTestId('f-entreprise')).toHaveValue('Loto-Québec');
  // source auto-détectée depuis l'URL LinkedIn
  await expect(page.getByTestId('f-source')).toHaveValue('LinkedIn');
  await expect(page.getByTestId('share-send')).toBeEnabled();
});

test('Share bloque l’envoi sans poste ni entreprise', async ({ page }) => {
  await page.goto('/share'); // pas d'URL → mode manuel
  await page.getByTestId('share-send').click();
  await expect(page.getByText(/au moins Poste ou Entreprise/)).toBeVisible();
});
