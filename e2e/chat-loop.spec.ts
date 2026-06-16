import { test, expect } from '@playwright/test';

/**
 * Vérifie la BOUCLE FERMÉE Claude↔Hermes :
 *   Jaona demande → Claude raisonne + émet [HERMES: tâche] → relais Hermes →
 *   Hermes exécute → bouton "Analyser avec Claude" → le résultat revient au
 *   cerveau qui conclut. On mocke /api/chat (branche selon body.mode).
 */

// Le SW recharge la page sur 'controllerchange' → on le bloque pour ce test.
test.use({ serviceWorkers: 'block' });

async function mockChat(page) {
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.mode === 'hermes') {
      // Hermes est async : kickoff -> { request_id }, puis polling -> { status:'done', ... }
      if (body.poll_id) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'done',
            response: 'Logs JobSpy : dernier run le 2026-06-04, **0 offre** collectée depuis.',
            session_id: 'sess-1',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ request_id: 'req-1', status: 'pending' }),
        });
      }
      return;
    }
    // mode claude : on distingue le 1er appel de la boucle-retour
    const isLoopback = (body.message || '').includes('Résultat obtenu');
    const reply = isLoopback
      ? 'Diagnostic : JobSpy est mort depuis le 4 juin. Prochaine étape : vérifier le cron nocturne.'
      : 'Je vérifie ça côté VPS.\n\n[HERMES: lis les logs JobSpy des 7 derniers jours]';
    const sse = 'data: ' + JSON.stringify({ token: reply }) + '\n\n' + 'data: [DONE]\n\n';
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
  });
}

test('boucle Claude→Hermes→Claude : le résultat revient au cerveau', async ({ page }) => {
  await mockChat(page);
  await page.goto('/chat.html');

  // 1. Jaona demande → Claude répond et propose une tâche Hermes
  await page.locator('#msg-input').fill('Où en est JobSpy ?');
  await page.locator('#send-btn').click();

  const claudeBubble = page.locator('#thread-claude .msg.claude.md').first();
  await expect(claudeBubble).toContainText('Je vérifie ça côté VPS');
  // le tag brut [HERMES: ...] ne doit PAS rester affiché dans la bulle
  await expect(claudeBubble).not.toContainText('[HERMES:');

  // 2. Le bloc relais Hermes apparaît → on l'envoie
  const relayBtn = page.locator('#thread-claude .relay-btn');
  await expect(relayBtn).toBeVisible();
  await relayBtn.click();

  // 3. Hermes répond dans son fil + bouton "Analyser avec Claude"
  const hermesBubble = page.locator('#thread-hermes .msg.hermes.md').first();
  await expect(hermesBubble).toContainText('dernier run le 2026-06-04');
  const backBtn = page.locator('#thread-hermes .relay-btn-c');
  await expect(backBtn).toBeVisible();

  // 4. On boucle vers Claude → le résultat est réinjecté et Claude conclut
  await backBtn.click();
  await expect(page.locator('#thread-claude .msg.system', { hasText: 'transmis à Claude' })).toBeVisible();
  await expect(page.locator('#thread-claude .msg.claude.md').last()).toContainText('mort depuis le 4 juin');
});

test('un tag d\'EXEMPLE cité par Claude n\'est pas relayé — seule la vraie tâche finale l\'est', async ({ page }) => {
  // Reproduit le bug "boucle" : Claude illustre le mécanisme avec un tag gabarit,
  // puis émet la vraie tâche à la fin. Le relais doit ignorer le gabarit.
  await page.route('**/api/chat', async (route) => {
    const reply =
      'Voici comment ça marche : j\'émets [HERMES: description précise de la tâche en français] ' +
      'et le PWA te propose de l\'envoyer.\n\n[HERMES: lis le fichier scoring_memory.json et résume les patterns]';
    const sse = 'data: ' + JSON.stringify({ token: reply }) + '\n\n' + 'data: [DONE]\n\n';
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
  });
  await page.goto('/chat.html');

  await page.locator('#msg-input').fill('Explique-moi la boucle');
  await page.locator('#send-btn').click();

  const relayTask = page.locator('#thread-claude .relay-task');
  await expect(relayTask).toBeVisible();
  await expect(relayTask).toContainText('scoring_memory.json');
  await expect(relayTask).not.toContainText('description précise');
  // Un seul relais (pas un par tag)
  await expect(page.locator('#thread-claude .hermes-relay')).toHaveCount(1);
});

test('puce "Idées d\'Hermes" : envoie une demande de lecture de suggestions.md', async ({ page }) => {
  await mockChat(page);
  await page.goto('/chat.html');

  await page.locator('.chip', { hasText: 'Idées d\'Hermes' }).click();

  // Le message envoyé à Claude mentionne bien le fichier de suggestions
  await expect(page.locator('#thread-claude .msg.user')).toContainText('suggestions.md');
  // Claude répond (et proposera la tâche Hermes)
  await expect(page.locator('#thread-claude .msg.claude.md').first()).toContainText('Je vérifie ça');
});
