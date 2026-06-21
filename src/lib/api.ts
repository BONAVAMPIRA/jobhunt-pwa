// Passerelle /api/* (proxy serverless Vercel → VPS). Jamais cachée (SW NetworkOnly).
// Contrats inchangés par la migration (cf. mémoire project_pwa_moderne_skill).

export async function getJSON<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...opts });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json() as Promise<T>;
}

export async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json() as Promise<T>;
}
