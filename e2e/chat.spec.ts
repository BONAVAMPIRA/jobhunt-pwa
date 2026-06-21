import { test, expect } from '@playwright/test';

// Construit un flux SSE comme /api/chat (mode claude) : tokens + cost + [DONE].
function sse(tokens: string[], cost = 0.012): string {
  const lines = tokens.map((t) => `data: ${JSON.stringify({ token: t })}`);
  lines.push(`data: ${JSON.stringify({ cost })}`);
  lines.push('data: [DONE]');
  return lines.join('\n') + '\n';
}

test('Chat Claude : streaming + rendu Markdown', async ({ page }) => {
  await page.route('**/api/chat', (r) =>
    r.fulfill({ contentType: 'text/event-stream', body: sse(['Voici ', '**gras** et ', '`code`.']) })
  );
  await page.goto('/chat');
  await page.getByTestId('msg-input').fill('Bonjour');
  await page.getByTestId('send-btn').click();
  const thread = page.getByTestId('thread');
  await expect(thread.locator('strong', { hasText: 'gras' })).toBeVisible();
  await expect(thread.locator('code', { hasText: 'code' })).toBeVisible();
});

test('Chat Claude : tag [HERMES:] propose un relais vers le VPS', async ({ page }) => {
  await page.route('**/api/chat', (r) =>
    r.fulfill({ contentType: 'text/event-stream', body: sse(['Je lance ça. [HERMES: redémarrer le service cockpit-api sur le VPS]']) })
  );
  await page.goto('/chat');
  await page.getByTestId('msg-input').fill('Redémarre l’API');
  await page.getByTestId('send-btn').click();
  await expect(page.getByText('TÂCHE À EXÉCUTER SUR LE VPS', { exact: false })).toBeVisible();
  await expect(page.getByText('redémarrer le service cockpit-api')).toBeVisible();
});

test('Le mode Hermes affiche le coût gratuit', async ({ page }) => {
  await page.goto('/chat');
  await page.getByTestId('mode-hermes').click();
  await expect(page.getByText(/Hermes — gratuit/)).toBeVisible();
});
