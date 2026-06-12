import { test, expect } from '@playwright/test';

/**
 * B4.3 — Génération du CV PDF par offre depuis la page Postuler.
 * On mocke les routes /api/* (route interception) pour tester le parcours réel
 * de Jaona de façon déterministe, sans dépendre du backend ni d'un token.
 */

const JOB = {
  job_id: 'J-TEST-1', poste: 'Analyste BI', entreprise: 'ACME',
  url: 'https://example.com/offre', score: 82, deadline: '',
  docs: { lm: false, salaire: false, guide: false }, docs_ready: false,
};

test.describe('Postuler — CV PDF par offre (B4.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/perso', r => r.fulfill({ json: { nom: 'Jaona', localisation: 'Verdun' } }));
    await page.route('**/api/postuler-jobs', r => r.fulfill({ json: { jobs: [JOB], total: 1 } }));
  });

  test("le bloc CV PDF s'affiche et le bouton génère le PDF avec la variante choisie", async ({ page }) => {
    let cvReqUrl = '';
    await page.route('**/api/cv-pdf**', route => {
      cvReqUrl = route.request().url();
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: {
          'X-CV-Variant': 'BI',
          'Content-Disposition': 'attachment; filename="CV_Jaona_Rabaonarison_acme_analyste_bi.pdf"',
        },
        body: '%PDF-1.4\n%mock cv\n',
      });
    });

    await page.goto('/postuler');

    // Le bloc CV (PDF par offre) + son sélecteur de variante sont présents.
    await expect(page.getByText('CV — PDF par offre')).toBeVisible();
    const sel = page.locator('#cvVariant');
    await expect(sel).toBeVisible();

    // Jaona surcharge la variante auto-détectée puis génère.
    await sel.selectOption('BA');
    await page.locator('#cvGenBtn').click();

    // La requête est partie avec le bon job_id ET la variante surchargée.
    await expect.poll(() => cvReqUrl).toContain('/api/cv-pdf');
    expect(cvReqUrl).toContain('job_id=J-TEST-1');
    expect(cvReqUrl).toContain('variant=BA');

    // L'aperçu PDF s'ouvre dans la modale + la note confirme la variante renvoyée par le serveur.
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#modalBody iframe')).toBeAttached();
    await expect(page.locator('#cvNote')).toContainText('variante');
  });

  test('échec backend : la note affiche une erreur, pas de crash', async ({ page }) => {
    await page.route('**/api/cv-pdf**', route => route.fulfill({ status: 500, json: { detail: 'boom' } }));
    await page.goto('/postuler');
    await expect(page.locator('#cvGenBtn')).toBeVisible();
    await page.locator('#cvGenBtn').click();
    await expect(page.locator('#cvNote')).toContainText('Échec');
    // le bouton est réarmé (pas bloqué sur "Génération…")
    await expect(page.locator('#cvGenBtn')).toBeEnabled();
  });
});
