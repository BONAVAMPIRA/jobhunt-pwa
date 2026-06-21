import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Page de capture (cible de partage mobile). Autonome, sans nav.
// Auto-extraction via /api/process, repli copier-coller, envoi Apps Script.
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycby-4jNAn6oxvbNFzbVrX9TYEaOgD2G1TtA67Rom7njZvGvXnWfA2JvAiEhLzPembPp4/exec";
const FIELDS = ["poste", "entreprise", "lieu", "source", "date_publication", "deadline", "type_poste", "contexte", "mission", "qualifications", "autres"] as const;
type FieldKey = (typeof FIELDS)[number];
type Form = Record<FieldKey, string>;
const empty = (): Form => Object.fromEntries(FIELDS.map((k) => [k, ""])) as Form;

function detectSource(url: string): string {
  if (!url) return "";
  if (url.includes("linkedin.com")) return "LinkedIn";
  if (url.includes("indeed.com") || url.includes("emplois.ca")) return "Indeed";
  if (url.includes("jobillico.com")) return "Jobillico";
  if (url.includes("ziprecruiter.com")) return "ZipRecruiter";
  if (url.includes("glassdoor.com")) return "Glassdoor";
  if (url.includes("monster.com") || url.includes("monster.ca")) return "Monster";
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

const LABELS: Record<FieldKey, string> = {
  poste: "Poste", entreprise: "Entreprise", lieu: "Lieu", source: "Source",
  date_publication: "Date de publication", deadline: "Deadline", type_poste: "Type de poste",
  contexte: "Contexte de l'entreprise", mission: "Mission", qualifications: "Qualifications", autres: "Autres (salaire, avantages…)",
};
const TEXTAREAS: FieldKey[] = ["contexte", "mission", "qualifications", "autres"];

export function ShareScreen() {
  const [params] = useSearchParams();
  const pageUrl = params.get("url") || "";
  const [form, setForm] = useState<Form>(() => ({ ...empty(), source: detectSource(pageUrl) }));
  const [phase, setPhase] = useState<"analyzing" | "ready" | "manual" | "sending" | "sent">(pageUrl ? "analyzing" : "manual");
  const [fallback, setFallback] = useState(false);
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const started = useRef(false);

  const set = (k: FieldKey, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function analyze(text?: string) {
    const p = new URLSearchParams({ url: pageUrl });
    if (text) p.append("text", text.slice(0, 8000));
    const res = await fetch("/api/process?" + p.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    setForm((f) => { const next = { ...f }; for (const k of FIELDS) if (data[k]) next[k] = data[k]; return next; });
  }

  useEffect(() => {
    if (!pageUrl || started.current) return;
    started.current = true;
    analyze()
      .then(() => setPhase("ready"))
      .catch((e: Error) => { if (e.message === "fetch_failed" || e.message === "insufficient_content") setFallback(true); setPhase("manual"); });
  }, [pageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!form.poste && !form.entreprise) { setStatus({ msg: "Remplis au moins Poste ou Entreprise.", ok: false }); return; }
    setPhase("sending");
    setStatus({ msg: "Envoi…", ok: true });
    const payload: Record<string, string> = { url: pageUrl, timestamp: new Date().toISOString() };
    for (const k of FIELDS) payload[k] = (form[k] || "").trim();
    payload.source = payload.source || detectSource(pageUrl) || "manual_pwa";
    try {
      const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      setStatus({ msg: j.job_id ? "Envoyé ✓  ID : " + j.job_id : "Envoyé ✓", ok: true });
      setPhase("sent");
    } catch (e) {
      setStatus({ msg: "Erreur envoi : " + (e instanceof Error ? e.message : "réseau"), ok: false });
      setPhase("ready");
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-xl bg-background p-4 text-foreground">
      <h1 className="mb-3 text-base font-semibold text-primary">JobHunt — Capturer cette offre</h1>
      {pageUrl && <div className="mb-3 break-all text-[11px] text-muted-foreground">{pageUrl}</div>}

      {fallback && (
        <div className="mb-3.5 rounded-lg border border-border bg-card p-3.5">
          <p className="mb-2 text-[13px] text-warning">Auto-extraction impossible (site protégé). Colle le texte de l'offre ici :</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Sélectionne tout le texte de la page et colle-le ici…"
            className="mb-2 min-h-28 w-full resize-y rounded-md border border-input bg-background p-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring" />
          <Button variant="secondary" className="w-full" onClick={() => { if (paste.trim()) { setPhase("analyzing"); analyze(paste).then(() => setPhase("ready")).catch((e: Error) => setStatus({ msg: "Erreur : " + e.message, ok: false })); } }}>
            Analyser le texte collé
          </Button>
        </div>
      )}

      {phase === "analyzing" && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-muted-foreground">Analyse IA en cours…</div>
          <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full w-2/3 animate-pulse rounded bg-primary" /></div>
        </div>
      )}

      <div className="space-y-2.5">
        {FIELDS.map((k) =>
          TEXTAREAS.includes(k) ? (
            <div key={k}>
              <label className="mb-1 block text-xs text-muted-foreground">{LABELS[k]}</label>
              <textarea value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="min-h-20 w-full resize-y rounded-md border border-input bg-card p-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring" />
            </div>
          ) : (
            <div key={k}>
              <label className="mb-1 block text-xs text-muted-foreground">{LABELS[k]}</label>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)} data-testid={`f-${k}`}
                className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring" />
            </div>
          )
        )}
      </div>

      <Button className="mt-4 w-full" data-testid="share-send" disabled={phase === "analyzing" || phase === "sending" || phase === "sent"} onClick={send}>
        {phase === "analyzing" ? "Patientez…" : phase === "sent" ? "Envoyé ✓" : !pageUrl && phase === "manual" ? "Envoyer manuellement" : "Confirmer et envoyer"}
      </Button>
      {status && <div className={cn("mt-2 text-center text-[13px]", status.ok ? "text-success" : "text-destructive")}>{status.msg}</div>}
    </div>
  );
}
