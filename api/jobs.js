export const config = { runtime: 'edge' };

// Proxy vers l'API VPS pour /api/jobs et /api/docs-status et /api/job-action
export default async function handler(req) {
  const COCKPIT_URL = process.env.COCKPIT_API_URL;
  if (!COCKPIT_URL) {
    return new Response(JSON.stringify({ error: 'COCKPIT_API_URL manquante' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(req.url);
  const path = url.pathname; // /api/jobs ou /api/docs-status
  const search = url.search;

  // Token injecté côté serveur — jamais exposé au navigateur (Fix 2 sécurité P0).
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.COCKPIT_API_TOKEN) headers['Authorization'] = `Bearer ${process.env.COCKPIT_API_TOKEN}`;

  try {
    const upstream = await fetch(`${COCKPIT_URL}${path}${search}`, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? await req.text() : undefined,
    });
    // Stream du corps tel quel : préserve le binaire (.docx) ET le JSON.
    const outHeaders = new Headers(upstream.headers);
    outHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
