import { test, expect } from '@playwright/test';

/**
 * Garde-fou budget : le chat affiche le coût cumulé de la session (mode Claude,
 * payant) et indique « gratuit » en mode Hermes. On mocke /api/chat pour émettre
 * un événement de coût dans le flux SSE.
 */

test.use({ serviceWorkers: 'block' });

test('budget : la barre de coût se met à jour après une réponse Claude', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const sse =
      'data: ' + JSON.stringify({ token: 'Réponse de test.' }) + '\n\n' +
      'data: ' + JSON.stringify({ usage: { input: 1000, output: 200 }, cost: 0.012 }) + '\n\n' +
      'data: [DONE]\n\n';
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
  });

  await page.goto('/chat.html');
  const bar = page.locator('#cost-bar');
  await expect(bar).toBeVisible();

  await page.locator('#msg-input').fill('coût ?');
  await page.locator('#send-btn').click();

  // Le coût cumulé s'affiche (0,012 $ → arrondi à 0,01 $ sur la barre)
  await expect(bar).toContainText('Session');
  await expect(bar).toContainText('0,01');

  // En mode Hermes, la barre indique gratuit
  await page.locator('#btn-hermes').click();
  await expect(bar).toContainText('gratuit');
});
