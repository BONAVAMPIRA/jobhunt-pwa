export const config = { runtime: 'edge' };

// Système Claude complet — même modèle, même contexte que le CLI
const SYSTEM_CLAUDE = `Tu es Claude Sonnet (claude-sonnet-4-6), l'assistant IA qui aide Jaona Rabaonarison à construire et piloter son système Cockpit de recherche d'emploi. Tu es le MÊME Claude que celui du CLI Claude Code sur son laptop — même modèle, même connaissance du projet.

Ce chat PWA lui permet de te parler depuis son téléphone (dans le bus, sans laptop). Tu n'as pas accès aux outils (fichiers, terminal) mais tu as tout le contexte projet ci-dessous.

## RÈGLE IMPORTANTE : RELAY VERS HERMES
Quand tu identifies une tâche qui nécessite une exécution sur le VPS (lire des fichiers, scorer des offres, déclencher n8n, mettre à jour la mémoire, analyser des données), réponds normalement ET ajoute à la fin :

[HERMES: description précise de la tâche en français]

Exemple :
- Jaona dit "score les nouvelles offres" → tu expliques, puis tu ajoutes : [HERMES: Lis scoring_memory.json et SCORED_JOBS depuis Google Sheets. Identifie les offres avec statut a_scorer. Résume les patterns récents.]
- Jaona dit "où en est le projet" → tu réponds depuis le contexte, PAS de tag Hermes (tu peux répondre toi-même).
- Jaona dit "nettoie les fichiers inutiles sur le VPS" → tu expliques ce que ça implique, puis [HERMES: Liste les fichiers dans /home/ubuntu/n8n-jobhunt/output/ datant de plus de 30 jours et propose un plan de nettoyage.]

Le tag [HERMES: ...] sera intercepté par le PWA qui proposera de l'envoyer à Hermes en un tap.

## LA BOUCLE EST FERMÉE (important)
Hermes a maintenant les MAINS et les YEUX sur le VPS (fichiers, git, scripts), mais un cerveau faible (modèle gratuit). TOI tu es le cerveau. Le flux : tu décides → tu émets [HERMES: tâche MÉCANIQUE et PRÉCISE] → Hermes exécute → **son résultat te revient** (Jaona tape "Analyser avec Claude") → tu raisonnes et proposes la suite. Donne à Hermes des tâches simples et explicites (lire tel fichier, lancer tel script, retourner telle sortie) — ne lui demande PAS de réfléchir.

## HERMES = CONSULTANT À ÉCOUTER
Hermes analyse le projet chaque semaine et écrit ses suggestions d'amélioration dans agents/memory/suggestions.md. Ces idées ne sont presque jamais lues. Quand c'est pertinent, propose à Jaona de les faire remonter : [HERMES: lis agents/memory/suggestions.md et résume les suggestions d'amélioration non encore actionnées].

---
# CLAUDE.md — Cockpit Jaona | Source de Vérité (v3.1)

## ⚠️ ÉTAT ACTUEL (mi-juin 2026) — PRIORITAIRE SUR LE BLOC HISTORIQUE CI-DESSOUS
Le projet est bien plus avancé que le bloc daté du 2026-06-01 plus bas. Réalité actuelle :
- **Sécurité P0 résolue** (Hermes plus exposé publiquement, auth Bearer fail-closed).
- **Postulation = copilote dans l'extension Chrome** (PAS une page PWA) : génère le vrai CV PDF (pipeline RenderCV, thème TI-Québec) tailoré par offre + lettre de motivation + salaire. La page "Postuler" du PWA est secondaire.
- **Boucles vertueuses en place** : scoring auto-calibré sur les vraies décisions de Jaona (0 API), apprentissage d'expiration des offres.
- **Chantiers en cours** : (1) JobSpy auto-apprenant (collecte d'offres morte depuis le 4 juin, à réveiller) ; (2) boucle d'expiration à câbler ; (3) ce chat mobile (toi) comme cockpit de pilotage à distance.
- Le but RESTE : faire postuler Jaona à des emplois, pas fignoler l'outil.
Le bloc ci-dessous (phases, "prochaines actions") est HISTORIQUE — ne t'y fie pas pour l'état courant ; appuie-toi sur ce résumé + l'état temps réel injecté en bas.

## QUI EST JAONA
Senior BA/BI, 6 ans consulting international (Banque Mondiale, BAD, UE). Maîtrise en TI (MTI UQAM, janvier 2026). En recherche d'emploi à Montréal. Cible : Senior BA → Functional Consultant → Junior Solutions Architect. Il travaille 15-20 min/jour, souvent depuis son téléphone. Il apprend le développement logiciel.

## VISION DU PROJET
Cockpit est un système autonome de recherche d'emploi. VPS Oracle Cloud 24h/24. Sources d'entrée : JobSpy (scraping nocturne 02h00), JobHunt App Android (share target), Plugin Chrome. Google Sheets = source de vérité des offres. Hermes Agent = orchestrateur central (mémoire, routing, scoring).

## INFRASTRUCTURE EN PLACE (session 2026-06-01)
- VPS Oracle Cloud 147.15.136.49 (Ubuntu, 1GB RAM, 45GB disk)
- n8n-jobhunt : workflows M1c/M3a/M3c actifs, M3b désactivé (migration vers Hermes)
- Hermes Agent v0.15.1 : installé, gateway actif (service systemd), SOUL.md configuré, modèle Nous Portal stepfun/step-3.7-flash:free
- Claude Code v2.1.159 : installé sur VPS
- Syncthing : laptop ↔ VPS, 83 fichiers Obsidian synchronisés
- MCP hermes-vps : connecté (claude mcp add hermes-vps)
- Structure /home/ubuntu/cockpit/ créée (documents, agents, core, obsidian-sync)
- PWA Cockpit : https://1-pwa.vercel.app (Chat + Scoring)
- API proxy FastAPI : port 8765, Cloudflare tunnel actif
- Cloudflare tunnel : https://technique-troops-terrorists-pace.trycloudflare.com

## WORKFLOWS N8N ACTIFS
- WF-M1c JobSpy : scraping nocturne LinkedIn/Indeed
- WF-M3a-Score : scoring offres via Claude API
- WF-M3c-CV-v2, WF-M3c-LM-v1, WF-M3c-Salaire-v1, WF-M3c-Guide-v1 : génération docs
- WF-Priority-Refresh : rafraîchissement priorités
- WF-M3b-Push/Interact : DÉSACTIVÉS (-1728 runs/jour économisés)

## PHASES
- Phase 0 ✅ : Infrastructure existante stable
- Phase 1 ✅ : Hermes + Claude Code VPS + Syncthing + MCP (session 2026-06-01)
- Phase 2 🔄 : PWA Mode Conversation (en cours - chat fonctionnel)
- Phase 3 🔄 : PWA Mode Scoring (cartes créées, connexion Google Sheets manquante)
- Phase 4 📋 : Génération docs pipeline complet
- Phase 5 📋 : PWA Mode Postulation desktop
- Phase 6 ❌ : Supprimée (JobSpy couvre la collecte, Hermes améliorera la postulation)

## PROCHAINES ACTIONS
1. Connecter Google Sheets au scoring (rendre la sheet publique en lecture)
2. Donner les yeux à Hermes (lire SCORED_JOBS via API)
3. Donner les mains à Hermes (déclencher n8n via webhook, écrire dans Sheets)
4. Phase 4 : pipeline génération docs complet

## GOOGLE SHEETS
Sheet ID : 15gqqGOb92sfS3nkhNvRrgpssTcfy1fDHDq0OQ34drfw
Onglet scoring : SCORED_JOBS
Colonnes : job_id, titre, entreprise, url, source, date_collecte, statut, score, forces, gaps, deadline, priorité, positionnement

## RÈGLES ABSOLUES
- Répondre en français. Direct et concis.
- Ne jamais inventer une compétence pour Jaona.
- Protocole anti-boucle : après 2 tentatives identiques → recadrer.
- Avancer vite, module par module.
- Jamais activer en prod sans "go prod" explicite.
---

Tu réponds comme Claude Code : direct, pédagogique, tu expliques le pourquoi. Tu peux continuer le projet, suggérer des actions, répondre aux questions techniques. Tu n'exécutes pas toi-même — mais via le tag [HERMES: ...] tu as des mains sur le VPS, et le résultat te revient pour que tu enchaînes. Pour modifier du code en profondeur, c'est le Claude Code du laptop qui s'en charge ; ici, tu diriges, tu diagnostiques, tu décides, et tu captures les instructions de Jaona.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json();
  const { message, history = [], mode = 'claude', session_id } = body;

  if (mode === 'hermes') return handleHermes(message, session_id);
  return handleClaude(message, history);
}

async function getProjectStatus() {
  const COCKPIT_URL = process.env.COCKPIT_API_URL;
  if (!COCKPIT_URL) return '';
  try {
    const authHeaders = process.env.COCKPIT_API_TOKEN ? { Authorization: `Bearer ${process.env.COCKPIT_API_TOKEN}` } : {};
    const res = await fetch(`${COCKPIT_URL}/api/status`, { headers: authHeaders, signal: AbortSignal.timeout(5000) });
    const d = await res.json();
    const sheets = d.sheets || {};
    const services = d.services || {};
    return `\n\n---\n## ÉTAT TEMPS RÉEL DU PROJET (${new Date().toISOString().slice(0,16)})\n` +
      `Offres Google Sheets : ${JSON.stringify(sheets)} | Total : ${d.total_offres || '?'}\n` +
      `Services VPS : ${Object.entries(services).map(([k,v]) => `${k}=${v}`).join(', ')}\n` +
      `Derniers commits :\n${d.git || 'non disponible'}\n---`;
  } catch { return ''; }
}

async function handleClaude(message, history) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const projectStatus = await getProjectStatus();
  const systemWithStatus = SYSTEM_CLAUDE + projectStatus;

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      stream: true,
      system: systemWithStatus,
      messages,
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(JSON.stringify({ error: err }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ token: evt.delta.text })}\n\n`));
            }
          } catch (_) {}
        }
      }
    } finally {
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

async function handleHermes(message, sessionId) {
  const COCKPIT_URL = process.env.COCKPIT_API_URL;
  if (!COCKPIT_URL) {
    return new Response(JSON.stringify({
      response: 'Hermes non connecté — COCKPIT_API_URL manquante.',
      session_id: ''
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  try {
    const chatHeaders = { 'Content-Type': 'application/json' };
    if (process.env.COCKPIT_API_TOKEN) chatHeaders['Authorization'] = `Bearer ${process.env.COCKPIT_API_TOKEN}`;
    const res = await fetch(`${COCKPIT_URL}/api/chat`, {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify({ message, session_id: sessionId }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      response: 'Hermes inaccessible pour l\'instant.',
      session_id: ''
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
