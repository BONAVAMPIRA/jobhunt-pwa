import { test, expect } from '@playwright/test';

/**
 * Vérifie que le chat rend le Markdown en HTML propre (plus de **gras** brut,
 * tableaux/listes/code formatés). On mocke /api/chat avec un flux SSE simulé
 * (la vraie route serverless échoue en local) et on inspecte la bulle rendue.
 */

// Le SW de la PWA recharge la page sur 'controllerchange' → efface le fil en
// plein test. On le bloque pour ce test (on teste le rendu, pas le SW).
test.use({ serviceWorkers: 'block' });

const MARKDOWN = [
  '## Titre de section',
  '',
  'Voici du **gras** et de l\'*italique* avec du `code inline`.',
  '',
  '| Contexte | Outils |',
  '|---|---|',
  '| CLI | fichiers, bash |',
  '| PWA | texte seul |',
  '',
  '- premier point',
  '- second point',
  '',
  'Et 185 offres (un nombre ne doit pas devenir du code).',
].join('\n');

test('chat : la réponse Markdown est rendue en HTML propre', async ({ page }) => {
  // Mock du flux SSE : un seul token contenant tout le Markdown, puis [DONE].
  await page.route('**/api/chat', async (route) => {
    const body =
      'data: ' + JSON.stringify({ token: MARKDOWN }) + '\n\n' +
      'data: [DONE]\n\n';
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body,
    });
  });

  await page.goto('/chat.html');
  await page.locator('#msg-input').fill('montre-moi du markdown');
  await page.locator('#send-btn').click();

  const bubble = page.locator('#thread-claude .msg.claude.md');
  await expect(bubble).toBeVisible();

  // Éléments structurels rendus en vrai HTML
  await expect(bubble.locator('h2')).toHaveText('Titre de section');
  await expect(bubble.locator('strong')).toHaveText('gras');
  await expect(bubble.locator('em')).toHaveText('italique');
  await expect(bubble.locator('code').first()).toHaveText('code inline');
  await expect(bubble.locator('table th').first()).toHaveText('Contexte');
  await expect(bubble.locator('table td')).toContainText(['CLI']);
  await expect(bubble.locator('ul li')).toHaveCount(2);

  // Le Markdown brut ne doit PAS rester visible
  const txt = await bubble.innerText();
  expect(txt).not.toContain('**');
  expect(txt).not.toContain('|---|');
  // Un nombre nu ne doit pas être transformé en <code>
  await expect(bubble.locator('code', { hasText: '185' })).toHaveCount(0);
});
