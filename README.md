# JobHunt PWA

Site statique multi-pages (Vercel). Pages : `index` (accueil), `scoring`, `postuler`, `chat`, `systeme`, `share`. Les routes propres (`/scoring`…) sont gérées par les `rewrites` de `vercel.json`. Les appels `/api/*` passent par la fonction serverless `api/jobs.js` (proxy vers l'API cockpit).

## Tests E2E (Playwright)

Harnais de tests de fumée sur la coquille des pages (titre + éléments centraux présents). Ne dépend pas des appels `/api/*` (qui échouent en local sans backend) — on teste le shell HTML statique.

### Prérequis (une fois)
```bash
cd modules/1-pwa
npm install
npx playwright install chromium
```
Node 20/22/24 requis.

### Lancer
```bash
npm run test:e2e        # headless, démarre le serveur statique local tout seul
npm run test:e2e:ui     # mode interactif (debug visuel)
```

Par défaut, `webServer` démarre `serve` sur http://localhost:3000 (les `cleanUrls` de `serve` reproduisent les rewrites Vercel : `/scoring` → `scoring.html`).

### Tester contre la preview/prod Vercel
```bash
BASE_URL=https://<preview>.vercel.app npm run test:e2e
```
Quand `BASE_URL` est défini, le serveur local n'est pas démarré (on tape directement l'URL distante).

### Intégration projet
Le subagent `reviewer` lance `npm run test:e2e` quand l'UI de la PWA change ; un échec E2E non expliqué = **NO-GO** (voir `.claude/agents/reviewer.md`).

Tests : `e2e/smoke.spec.ts`. Config : `playwright.config.ts`.
