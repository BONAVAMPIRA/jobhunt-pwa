// Téléchargement du dossier de candidature (CV PDF + LM/Salaire/Guide en .md).
// File System Access → Focus FindJob/AAAAMM/Entreprise/Poste/ ; repli téléchargements.
// Porté fidèlement de l'ancien suivi.html (contrats /api/cv-pdf et /api/doc inchangés).

export interface SuiviJob {
  job_id: string;
  statut?: string;
  tier?: string;
  score?: number;
  poste?: string;
  entreprise?: string;
  url?: string;
  salaire_cible?: string;
  salaire_plancher?: string;
  date?: string;
}

export const FS_OK = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

const safeName = (s?: string) =>
  String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Sans nom";
const monthFolder = () => new Date().toISOString().slice(0, 7).replace("-", "");

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("jobhunt", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(k: string): Promise<T | null> {
  const db = await idb();
  return new Promise((res) => {
    const t = db.transaction("kv").objectStore("kv").get(k);
    t.onsuccess = () => res(t.result as T);
    t.onerror = () => res(null);
  });
}
async function idbSet(k: string, v: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res) => {
    const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k);
    t.onsuccess = () => res();
    t.onerror = () => res();
  });
}

type DirHandle = any;
let rootHandle: DirHandle = null;
async function verifyPerm(h: DirHandle): Promise<boolean> {
  try {
    if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return (await h.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}
async function getRoot(): Promise<DirHandle> {
  if (rootHandle && (await verifyPerm(rootHandle))) return rootHandle;
  const stored = await idbGet<DirHandle>("root");
  if (stored && (await verifyPerm(stored))) { rootHandle = stored; return rootHandle; }
  const h = await (window as any).showDirectoryPicker({ id: "focusfindjob", mode: "readwrite" });
  await idbSet("root", h);
  rootHandle = h;
  return h;
}
async function ensureDir(root: DirHandle, parts: string[]): Promise<DirHandle> {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}
async function writeFile(dir: DirHandle, name: string, blob: Blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

async function fetchDocs(job: SuiviJob): Promise<{ name: string; blob: Blob }[]> {
  const co = safeName(job.entreprise);
  const out: { name: string; blob: Blob }[] = [];
  try {
    const cv = await fetch(`/api/cv-pdf?job_id=${encodeURIComponent(job.job_id)}&variant=auto`, { cache: "no-store" });
    if (cv.ok) out.push({ name: `${co} - CV Jaona RABAONARISON.pdf`, blob: await cv.blob() });
  } catch { /* skip */ }
  const docs: [string, string][] = [
    ["lm", `${co} - CL Jaona RABAONARISON.md`],
    ["salaire", `${co} - Analyse salariale.md`],
    ["guide", `${co} - Guide entretien.md`],
  ];
  for (const [type, name] of docs) {
    try {
      const d = await (await fetch(`/api/doc?job_id=${encodeURIComponent(job.job_id)}&type=${type}&format=md`)).json();
      if (d && d.content) out.push({ name, blob: new Blob([d.content], { type: "text/markdown" }) });
    } catch { /* skip */ }
  }
  return out;
}

async function fallback(job: SuiviJob, files: { name: string; blob: Blob }[]) {
  const prefix = `${monthFolder()} ${safeName(job.entreprise)} ${safeName(job.poste)} - `;
  for (const f of files) {
    const u = URL.createObjectURL(f.blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = prefix + f.name.replace(/^.* - /, "");
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export interface DossierResult { message: string; warn: boolean }

export async function downloadDossier(job: SuiviJob): Promise<DossierResult> {
  const files = await fetchDocs(job);
  if (!files.length) return { message: "Aucun document à télécharger", warn: true };
  if (FS_OK) {
    let root: DirHandle;
    try {
      root = await getRoot();
    } catch {
      await fallback(job, files);
      return { message: "Dossier non autorisé — téléchargement classique", warn: true };
    }
    const dir = await ensureDir(root, [monthFolder(), safeName(job.entreprise), safeName(job.poste)]);
    for (const f of files) await writeFile(dir, f.name, f.blob);
    return { message: `Dossier écrit → ${monthFolder()}/${safeName(job.entreprise)}/${safeName(job.poste)} (${files.length})`, warn: false };
  }
  await fallback(job, files);
  return { message: "Téléchargé dans Téléchargements", warn: false };
}
