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

  test('CV éditable : préparer le texte → éditer → rendre le PDF', async () => {
    await context.route('**/api/profil', r => r.fulfill({
      json: { identite: { nom: 'Jaona Rabaonarison', localisation: 'Verdun', telephone: '438', email: 'x@y.z' } },
    }));
    await context.route('**/api/postuler-jobs', r => r.fulfill({
      json: { jobs: [{ job_id: 'J-T', entreprise: 'ACME', poste: 'Analyste BI', score: 82, tier: 'B', docs: { lm: true, salaire: true, guide: true } }], total: 1 },
    }));
    await context.route('**/api/doc**', r => r.fulfill({ json: { content: '## Doc\nTexte de test.' } }));
    // Étape 1 : le YAML tailoré, éditable.
    let yamlUrl = '';
    await context.route('**/api/cv-yaml**', route => {
      yamlUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ job_id: 'J-T', variant: 'BI', yaml: 'cv:\n  name: Jaona Rabaonarison\n' }) });
    });
    // Étape 2 : rendu depuis le YAML (éventuellement édité).
    let renderBody: any = null;
    await context.route('**/api/cv-render', route => {
      renderBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="CV.pdf"' }, body: '%PDF-1.4\n%mock cv\n' });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/ui/sidepanel.html`);

    await page.locator('.jobchip').first().click();
    await expect(page.getByText('CV — PDF TI Québec')).toBeVisible();

    // Étape 1 : préparer -> le texte éditable apparaît, pré-rempli + auto-détecté.
    await page.locator('#cvPrep').click();
    const ta = page.locator('#cvYaml');
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue(/Jaona Rabaonarison/);
    expect(yamlUrl).toContain('job_id=J-T');

    // Édition + rendu -> l'aperçu plein écran s'affiche (plus d'iframe miniature depuis
    // le refactor CV éditable) et le YAML édité est bien envoyé.
    await ta.fill('cv:\n  name: Jaona EDITED\n');
    await page.locator('.cvrender').click();
    await expect(page.locator('#cvPreview .cvbig')).toBeVisible();
    expect(renderBody.yaml).toContain('Jaona EDITED');
  });
});
