import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Harnais Playwright pour l'EXTENSION (copilote, sidepanel MV3).
 * On charge réellement l'extension dans un contexte Chrome persistant, on mocke
 * /api/* (déterministe, sans token), et on vérifie le parcours « Générer le CV PDF ».
 * Headed obligatoire : Chromium ne charge les extensions qu'en mode tête.
 */

const EXT = path.resolve(__dirname, '..', '..', '1-extension');

test.describe('Copilote extension — CV PDF (B4.3 extension)', () => {
  test.skip(!fs.existsSync(EXT), 'modules/1-extension absent (clone PWA seul)');
  let context: BrowserContext;
  let extId = '';

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    // ID de l'extension via son service worker (MV3).
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    extId = new URL(sw.url()).host;
  });

  test.afterAll(async () => { await context?.close(); });

  test('génère le CV PDF avec la variante choisie', async () => {
    await context.route('**/api/profil', r => r.fulfill({
      json: { identite: { nom: 'Jaona', localisation: 'Verdun', telephone: '438', email: 'x@y.z' } },
    }));
    await context.route('**/api/postuler-jobs', r => r.fulfill({
      json: { jobs: [{ job_id: 'J-T', entreprise: 'ACME', poste: 'Analyste BI', score: 82, docs: { lm: true, salaire: true, guide: true } }], total: 1 },
    }));
    await context.route('**/api/doc**', r => r.fulfill({ json: { content: '## Doc\nTexte de test.' } }));
    let cvUrl = '';
    await context.route('**/api/cv-pdf**', route => {
      cvUrl = route.request().url();
      return route.fulfill({
        status: 200, contentType: 'application/pdf',
        headers: { 'X-CV-Variant': 'BI', 'Content-Disposition': 'attachment; filename="CV.pdf"' },
        body: '%PDF-1.4\n%mock cv\n',
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/ui/sidepanel.html`);

    // Ouvre la section CV/Lettre (repliée par défaut) -> charge les offres.
    await page.locator('summary', { hasText: 'CV / Lettre' }).click();
    await page.locator('.jobchip').first().click();

    // Le bloc CV PDF apparaît ; on surcharge la variante puis on génère.
    await expect(page.getByText('CV — PDF TI Québec')).toBeVisible();
    await page.locator('#cvVariant').selectOption('BA');
    await page.locator('#cvGen').click();

    // La requête est partie avec le bon job_id + la variante surchargée.
    await expect.poll(() => cvUrl).toContain('/api/cv-pdf');
    expect(cvUrl).toContain('job_id=J-T');
    expect(cvUrl).toContain('variant=BA');

    // L'aperçu PDF (iframe) s'affiche dans le panneau.
    await expect(page.locator('#cvPreview iframe')).toBeAttached();
    await expect(page.locator('#cvNote')).toContainText('Variante');
  });
});
