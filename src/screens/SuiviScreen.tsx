import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Download, Inbox, Search, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getJSON } from "@/lib/api";
import { downloadDossier, FS_OK, type SuiviJob } from "@/lib/dossier";
import { cn } from "@/lib/utils";

function statusBadge(s?: string): { label: string; variant: "success" | "warning" | "default" | "danger" | "muted" } {
  const map: Record<string, { label: string; variant: "success" | "warning" | "default" | "danger" | "muted" }> = {
    postule: { label: "POSTULÉ", variant: "success" },
    "postulé": { label: "POSTULÉ", variant: "success" },
    entrevue: { label: "ENTREVUE", variant: "warning" },
    offre: { label: "OFFRE", variant: "default" },
    refuse: { label: "REFUSÉ", variant: "danger" },
    "refusé": { label: "REFUSÉ", variant: "danger" },
  };
  return map[s ?? ""] ?? { label: (s || "—").toUpperCase(), variant: "muted" };
}

function SuiviCard({ job, onToast }: { job: SuiviJob; onToast: (m: string, warn: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const sb = statusBadge(job.statut);
  const hasSal = job.salaire_cible || job.salaire_plancher;

  async function dl() {
    setBusy(true);
    try {
      const r = await downloadDossier(job);
      onToast(r.message, r.warn);
    } catch (e) {
      onToast("Échec : " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={sb.variant}>{sb.label}</Badge>
          {job.tier && <Badge variant="outline">Tier {job.tier}</Badge>}
          {job.score != null && <span className="ml-auto text-[11px] text-muted-foreground">score {job.score}</span>}
        </div>
        <div>
          <div className="text-sm font-semibold leading-snug text-foreground">{job.poste || "—"}</div>
          {job.entreprise && <div className="text-xs text-primary">{job.entreprise}</div>}
        </div>

        {hasSal ? (
          <div className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2">
            <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold tracking-wider text-success">
              <Wallet className="size-3" />PRÉTENTION SALARIALE
            </div>
            <div className="text-xs text-foreground">
              Cible : <strong>{job.salaire_cible || "—"}</strong>
              {job.salaire_plancher && <span className="text-muted-foreground"> · Plancher : {job.salaire_plancher}</span>}
            </div>
          </div>
        ) : (
          <div className="text-[11px] italic text-muted-foreground">Analyse salariale non disponible.</div>
        )}

        {job.date && <div className="text-[11px] text-muted-foreground">Candidature : {job.date}</div>}

        <div className="flex flex-wrap gap-2 pt-1">
          {job.url && (
            <Button variant="secondary" size="sm" onClick={() => window.open(job.url, "_blank", "noopener")}>
              <ExternalLink />Offre
            </Button>
          )}
          <Button size="sm" onClick={dl} disabled={busy} data-testid="btn-dossier">
            <Download />{busy ? "…" : "Dossier"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SuiviScreen() {
  const [jobs, setJobs] = useState<SuiviJob[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; warn: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await getJSON<{ jobs?: SuiviJob[]; error?: string }>("/api/suivi");
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setJobs(d.jobs || []);
      } catch (e) {
        if (alive) showToast("Suivi indisponible : " + (e instanceof Error ? e.message : String(e)), true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function showToast(msg: string, warn: boolean) {
    setToast({ msg, warn });
    setTimeout(() => setToast(null), 3000);
  }

  const ql = q.trim().toLowerCase();
  const shown = jobs.filter((j) => !ql || `${j.entreprise} ${j.poste}`.toLowerCase().includes(ql));

  return (
    <AppShell title="Suivi" actions={<Badge variant="default">{loading ? "—" : shown.length}</Badge>}>
      <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une entreprise, un poste…"
            className="w-full rounded-md border border-input bg-card py-2 pl-8 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {FS_OK
            ? "💡 Au 1er « Dossier », choisis ton dossier Focus FindJob une fois — ensuite tout y est rangé par mois."
            : "ℹ️ Ce navigateur écrit dans Téléchargements (range-les ensuite)."}
        </p>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 p-3.5">
        {loading && <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>}

        {!loading && jobs.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <Inbox className="mx-auto mb-2 size-8" />
            <strong className="text-foreground">Aucune candidature suivie</strong>
            <p className="mt-2 text-xs">Les offres au statut <strong>postulé</strong> apparaîtront ici (« ✅ J'ai postulé » dans le copilote).</p>
          </div>
        )}

        {!loading && jobs.length > 0 && shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {q} ».
          </div>
        )}

        <AnimatePresence>
          {shown.map((job) => (
            <motion.div key={job.job_id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <SuiviCard job={job} onToast={showToast} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {toast && (
        <div className={cn(
          "fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3.5 py-2 text-xs shadow-lg",
          toast.warn ? "border-warning/50 bg-card text-warning" : "border-border bg-card text-foreground"
        )}>
          {toast.msg}
        </div>
      )}
    </AppShell>
  );
}
