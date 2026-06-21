import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ExternalLink, CalendarClock, Sparkles, AlertTriangle, CheckCircle2,
  Wand2, MessageSquareWarning, X, RotateCcw, Loader2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getJSON, postJSON } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types (contrat /api/jobs inchangé) ───────────────────────────────
type Gap = string | { gap?: string; text?: string; explication?: string; explanation?: string; exp?: string };
export interface Job {
  job_id: string;
  titre?: string;
  entreprise?: string;
  url?: string;
  score?: number;
  tier?: "A" | "B" | "C" | string;
  priorite?: string;
  deadline?: string;
  date_collecte?: string;
  positionnement?: string;
  recommandation?: string;
  forces?: string[];
  gaps?: Gap[];
}
type SortMode = "tier" | "prio" | "score";

// ── Helpers (portés de scoring.html) ─────────────────────────────────
const LIFESPAN_DAYS = 30;
function daysLeft(deadline?: string): number | null {
  if (!deadline) return null;
  const d = new Date(String(deadline).replace(/\//g, "-"));
  return isNaN(d.getTime()) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
}
function freshness(job: Job): { daysLeft: number | null; estimated: boolean } {
  const dl = daysLeft(job.deadline);
  if (dl !== null) return { daysLeft: dl, estimated: false };
  const pd = job.date_collecte ? new Date(String(job.date_collecte).replace(/\//g, "-")) : null;
  if (pd && !isNaN(pd.getTime())) {
    return { daysLeft: Math.ceil((pd.getTime() + LIFESPAN_DAYS * 86400000 - Date.now()) / 86400000), estimated: true };
  }
  return { daysLeft: null, estimated: false };
}
const PRIO_RANK: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, P1: 1, P2: 2, P3: 3, "1": 1, "2": 2, "3": 3 };
function prioLabel(p?: string): string | null {
  if (!p) return null;
  const m: Record<string, string> = { A: "P1", B: "P2", C: "P3", D: "P4" };
  if (m[p]) return m[p];
  return p.startsWith("P") ? p : `P${p}`;
}
function prioVariant(p?: string): "danger" | "warning" | "outline" {
  const n = PRIO_RANK[p ?? ""] || 99;
  return n <= 1 ? "danger" : n === 2 ? "warning" : "outline";
}
function scoreColor(s = 0): string {
  return s >= 75 ? "text-success" : s >= 55 ? "text-warning" : "text-muted-foreground";
}
function scoreBar(s = 0): string {
  return s >= 75 ? "bg-success" : s >= 55 ? "bg-warning" : "bg-muted-foreground";
}
function gapText(g: Gap): string {
  return typeof g === "string" ? g : g.gap || g.text || "";
}
function gapExp(g: Gap): string {
  return typeof g === "object" ? g.explication || g.explanation || g.exp || "" : "";
}
function tierMeta(t?: string): { label: string; variant: "success" | "default" | "muted" } | null {
  const map: Record<string, { label: string; variant: "success" | "default" | "muted" }> = {
    A: { label: "🅰 viser", variant: "success" },
    B: { label: "🅱 entrée", variant: "default" },
    C: { label: "🅲 filet", variant: "muted" },
  };
  return t ? map[t] ?? null : null;
}

function sortJobs(list: Job[], mode: SortMode): Job[] {
  const isExp = (j: Job) => { const d = freshness(j).daysLeft; return d !== null && d < 0; };
  return [...list].sort((a, b) => {
    const ea = isExp(a) ? 1 : 0, eb = isExp(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    if (mode === "tier") {
      const t: Record<string, number> = { A: 0, B: 1, C: 2 };
      const ta = t[a.tier ?? ""] ?? 9, tb = t[b.tier ?? ""] ?? 9;
      if (ta !== tb) return ta - tb;
      return (b.score || 0) - (a.score || 0);
    }
    if (mode === "prio") {
      const pa = PRIO_RANK[a.priorite ?? ""] || 99, pb = PRIO_RANK[b.priorite ?? ""] || 99;
      if (pa !== pb) return pa - pb;
      const da = freshness(a).daysLeft ?? 999, db = freshness(b).daysLeft ?? 999;
      if (da !== db) return da - db;
      return (b.score || 0) - (a.score || 0);
    }
    return (b.score || 0) - (a.score || 0);
  });
}

// ── Carte offre (gère son propre état générer / contester) ───────────
function JobCard({ job, onRemove, onUpdate }: {
  job: Job;
  onRemove: (id: string) => void;
  onUpdate: (job: Job) => void;
}) {
  const [mode, setMode] = useState<"idle" | "generating" | "contesting" | "rescoring">("idle");
  const [comment, setComment] = useState("");
  const [genPct, setGenPct] = useState(5);
  const [genStatus, setGenStatus] = useState("");
  const [revised, setRevised] = useState(false);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearInterval); }, []);

  const f = freshness(job);
  const days = f.daysLeft;
  const expired = days !== null && days < 0;
  const urgent = days !== null && days >= 0 && days <= 7;
  const deadlineText = days === null ? "" : days < 0 ? `Expirée${f.estimated ? " (est.)" : ""}` : `${f.estimated ? "~" : ""}${days}j restants`;
  const pLabel = prioLabel(job.priorite);
  const tier = tierMeta(job.tier);
  const forces = (job.forces || []).slice(0, 5);
  const gaps = (job.gaps || []).slice(0, 12);

  async function fireAction(action: "abandonner") {
    onRemove(job.job_id);
    try { await postJSON("/api/job-action", { job_id: job.job_id, action }); } catch { /* best-effort */ }
  }

  function generate() {
    if (!window.confirm("Générer les 4 documents (CV, Lettre, Analyse salariale, Guide) ?\nCela lance des appels IA payants (~0,35 $ par offre).")) return;
    setMode("generating");
    setGenStatus("⏳ Génération en cours (CV, LM, Guide, Salaire)…");
    postJSON("/api/job-action", { job_id: job.job_id, action: "postuler" }).catch(() => {});
    const prog = setInterval(() => setGenPct((p) => Math.min(p + (90 - p) * 0.03 + 0.5, 88)), 2000);
    timers.current.push(prog);
    let attempts = 0;
    const check = setInterval(async () => {
      attempts++;
      try {
        const data = await getJSON<{ ready?: boolean; docs?: Record<string, unknown> }>(`/api/docs-status?job_id=${job.job_id}`);
        if (data.ready) {
          timers.current.forEach(clearInterval);
          setGenPct(100);
          setGenStatus("✅ Documents prêts : " + Object.keys(data.docs || {}).map((d) => d.toUpperCase()).join(" · "));
          setTimeout(() => onRemove(job.job_id), 3000);
        }
      } catch { /* retry */ }
      if (attempts > 20) {
        timers.current.forEach(clearInterval);
        setGenStatus("⚠ Génération longue — vérifie dans Suivi.");
      }
    }, 15000);
    timers.current.push(check);
  }

  async function submitContest() {
    const c = comment.trim();
    if (!c) return;
    const oldScore = job.score;
    setMode("rescoring");
    try {
      const res = await fetch("/api/rescore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.job_id, comment: c }),
      });
      if (!res.ok) throw new Error("start");
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const d = await getJSON<{ ready?: boolean; result?: any }>(`/api/rescore-result?job_id=${encodeURIComponent(job.job_id)}`);
          if (d.ready) {
            clearInterval(poll);
            const r = d.result || {};
            if (r.error) { setMode("idle"); return; }
            const next: Job = { ...job };
            if (r.score !== undefined && r.score !== "") next.score = parseInt(r.score) || job.score;
            if (r.positionnement) next.positionnement = r.positionnement;
            if (r.recommandation) next.recommandation = r.recommandation;
            if (r.gaps_json) { try { next.gaps = Array.isArray(r.gaps_json) ? r.gaps_json : JSON.parse(r.gaps_json); } catch { /* keep */ } }
            onUpdate(next);
            setRevised(true);
            setMode("idle");
            void oldScore;
          }
        } catch { /* retry */ }
        if (tries > 40) { clearInterval(poll); setMode("idle"); }
      }, 3000);
      timers.current.push(poll);
    } catch { setMode("idle"); }
  }

  return (
    <Card className={cn("overflow-hidden", expired && "opacity-60 border-l-2 border-l-destructive")}>
      <CardContent className="space-y-2.5">
        {revised && (
          <div className="rounded-md bg-success/15 px-2.5 py-1.5 text-[11px] text-success">
            ↻ Score révisé. Lacunes mises à jour — tu peux ⚙️ Générer ou ✕ Abandonner.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {tier && <Badge variant={tier.variant}>{tier.label}</Badge>}
          {pLabel && <Badge variant={prioVariant(job.priorite)}>{pLabel}</Badge>}
          {deadlineText && (
            <Badge variant={urgent || expired ? "danger" : "muted"}>
              <CalendarClock className="size-3" />{deadlineText}
            </Badge>
          )}
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25">
              <ExternalLink className="size-3" />Voir l'offre
            </a>
          )}
        </div>

        <div>
          <div className="text-sm font-semibold leading-snug text-foreground">{job.titre || "—"}</div>
          {job.entreprise && <div className="text-xs text-primary">{job.entreprise}</div>}
        </div>

        <div className="flex items-center gap-2.5">
          <div className={cn("min-w-11 text-2xl font-extrabold", scoreColor(job.score))}>
            {job.score || 0}<span className="text-[11px] font-normal text-muted-foreground">/100</span>
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all duration-500", scoreBar(job.score))} style={{ width: `${job.score || 0}%` }} />
          </div>
        </div>

        {job.positionnement && <p className="text-[11.5px] leading-relaxed text-muted-foreground">{job.positionnement}</p>}

        {forces.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-success">
              <Sparkles className="size-3" />FORCES
            </div>
            <ul className="space-y-1">
              {forces.map((x, i) => (
                <li key={i} className="pl-3 text-xs leading-snug text-foreground before:absolute before:-ml-3 before:text-success before:content-['•'] relative">{x}</li>
              ))}
            </ul>
          </div>
        )}

        {gaps.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-destructive">
              <AlertTriangle className="size-3" />GAPS
            </div>
            <ul className="space-y-1.5">
              {gaps.map((g, i) => (
                <li key={i} className="text-xs leading-snug text-destructive/90">
                  <span className="mr-1">⚠</span>{gapText(g)}
                  {gapExp(g) && <div className="mt-0.5 text-[11px] font-normal text-primary">💡 {gapExp(g)}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <div className="border-t border-border p-2.5">
        {mode === "idle" && (
          <div className="flex gap-2">
            <Button variant="success" size="sm" className="flex-1" onClick={generate} data-testid="btn-generer">
              <Wand2 />Générer
            </Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setMode("contesting")} data-testid="btn-contester">
              <MessageSquareWarning />Contester
            </Button>
            <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={() => fireAction("abandonner")} data-testid="btn-abandonner">
              <X />Abandonner
            </Button>
          </div>
        )}

        {mode === "generating" && (
          <div className="space-y-1.5 py-1 text-center text-xs text-success">
            <div>{genStatus}</div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-success transition-all duration-500" style={{ width: `${genPct}%` }} />
            </div>
          </div>
        )}

        {mode === "contesting" && (
          <div className="space-y-2">
            <textarea
              autoFocus value={comment} onChange={(e) => setComment(e.target.value)}
              data-testid="contest-input"
              placeholder="Pourquoi ce score te semble faux ? (ex : 3 ans de Power BI non comptés…)"
              className="min-h-16 w-full resize-y rounded-md border border-input bg-background p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={submitContest}><RotateCcw />Re-scorer</Button>
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setMode("idle"); setComment(""); }}>Annuler</Button>
            </div>
          </div>
        )}

        {mode === "rescoring" && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-primary">
            <Loader2 className="size-4 animate-spin" />Claude révise le score… (~30 s)
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Écran ────────────────────────────────────────────────────────────
export function ScoringScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("tier");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000);
        const data = await getJSON<{ jobs?: Job[]; error?: string }>("/api/jobs", { signal: ctrl.signal });
        clearTimeout(to);
        if (!alive) return;
        if (data.error) throw new Error(data.error);
        setJobs(data.jobs || []);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? (e.name === "AbortError" ? "Timeout 15 s — l'API n'a pas répondu" : e.message) : "inconnue");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const remove = (id: string) => setJobs((js) => js.filter((j) => j.job_id !== id));
  const update = (job: Job) => setJobs((js) => js.map((j) => (j.job_id === job.job_id ? job : j)));
  const sorted = sortJobs(jobs, sortMode);

  const sortBtn = (mode: SortMode, label: string) => (
    <button
      onClick={() => setSortMode(mode)}
      data-testid={`sort-${mode}`}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] transition-colors",
        sortMode === mode ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <AppShell
      title="Scoring"
      actions={
        <>
          <Badge variant="default" data-testid="count">{loading ? "—" : sorted.length}</Badge>
          {sortBtn("tier", "Tier")}
          {sortBtn("prio", "Urgence")}
          {sortBtn("score", "Score")}
        </>
      }
    >
      <div className="mx-auto max-w-2xl space-y-3 p-3.5" data-testid="deck">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />Chargement des offres…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 size-8 text-warning" />
            <strong className="text-foreground">Impossible de charger les offres</strong>
            <p className="mt-2 text-xs">Erreur : {error}</p>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 size-8 text-success" />
            <strong className="text-foreground">Aucune offre à scorer</strong>
            <p className="mt-2 text-xs">Toutes les offres ont été traitées.</p>
          </div>
        )}

        <AnimatePresence>
          {sorted.map((job) => (
            <motion.div
              key={job.job_id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2 }}
            >
              <JobCard job={job} onRemove={remove} onUpdate={update} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
