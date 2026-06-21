import { test, expect } from '@playwright/test';

/**
 * Tests de fumée : on vérifie que la coquille de chaque page se charge
 * (titre + élément central présents). On NE dépend PAS des appels /api/*
 * (serverless Vercel + backend cockpit), qui échouent en local ; on cible
 * le shell HTML statique, rendu indépendamment de la donnée.
 */

test('accueil : la page se charge avec un titre non vide', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/); // titre non vide
  await expect(page.locator('h1')).toHaveText('JobHunt');
});

test('scoring : la page et le deck d\'offres sont présents', async ({ page }) => {
  await page.goto('/scoring');
  await expect(page).toHaveTitle(/Scoring/);
  await expect(page.locator('h1')).toContainText('Scoring');
  // #deck = conteneur central des cartes d'offres (présent même avant chargement data)
  await expect(page.locator('#deck')).toBeVisible();
  // les boutons de tri (cœur de l'UX scoring) sont là
  await expect(page.locator('#sort-prio')).toBeVisible();
  await expect(page.locator('#sort-score')).toBeVisible();
});

test('postuler : la page et la zone assistant/offre sont présentes', async ({ page }) => {
  await page.goto('/postuler');
  await expect(page).toHaveTitle(/Postuler/);
  await expect(page.locator('h1')).toContainText('Postuler');
  // #jobbar (barre des offres) + #asst (panneau assistant) = structure centrale M4
  await expect(page.locator('#jobbar')).toBeAttached();
  await expect(page.locator('#asst')).toBeAttached();
});
