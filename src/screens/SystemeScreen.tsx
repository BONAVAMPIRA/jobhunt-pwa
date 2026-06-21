import { useEffect, useState, useCallback, type ReactNode } from "react";
import { RefreshCw, HelpCircle, BarChart3, Target, RotateCw, ClipboardList, Play, Trash2, Wrench, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Aides au clic (libellé humain + explication) par clé de config connue.
const HELP: Record<string, [string, string]> = {
  search_terms: ["Mots-clés recherchés", "Les intitulés de poste que JobSpy cherche (ex. « business analyst, analyste BI »). Sépare par des virgules."],
  location: ["Lieu", "La ville/région ciblée (ex. « Montréal, QC »)."],
  results_wanted: ["Nombre d'offres", "Combien d'offres JobSpy ramène par recherche. Plus = plus de coût."],
  hours_old: ["Fraîcheur (heures)", "On ne garde que les offres publiées dans les X dernières heures."],
  sites: ["Sites scrutés", "Plateformes interrogées (linkedin, indeed, glassdoor…). Virgules."],
  country: ["Pays", "Pays utilisé par Indeed/Glassdoor (ex. « canada »)."],
  is_remote: ["Télétravail seulement", "true = uniquement télétravail ; false = toutes."],
  job_type: ["Type de poste", "fulltime, contract, parttime…"],
  min_score: ["Score minimum", "En dessous, une offre n'est pas mise en avant."],
};
const humanize = (k: string) => k.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const helpFor = (k: string): [string, string] => HELP[k] || [humanize(k), `Option « ${k} » du Sheet de configuration.`];

const NICE: Record<string, [string, string]> = {
  "n8n-jobhunt": ["Moteur de workflows (n8n)", "Orchestre collecte, scoring et génération de docs."],
  "cockpit-api": ["API du cockpit", "Le pont entre cette interface et le serveur."],
  "hermes-gateway": ["Hermes (assistant)", "La mémoire/concierge du projet."],
  syncthing: ["Synchronisation", "Réplique les fichiers entre serveur et laptop."],
};

interface Cron { id: number; name: string; schedule: string }

function ConfigRow({ k, value, onToast }: { k: string; value: string; onToast: (m: string, ok: boolean) => void }) {
  const [val, setVal] = useState(value);
  const [showHelp, setShowHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, help] = helpFor(k);
  const dirty = val !== value;

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value: val }) });
      onToast("Enregistré ✓ — actif à la prochaine collecte", true);
    } catch {
      onToast("Erreur", false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-border py-2.5 last:border-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <button onClick={() => setShowHelp((s) => !s)} className="grid size-4 place-items-center rounded-full border border-border text-[10px] text-primary" aria-label="aide">
          <HelpCircle className="size-3" />
        </button>
      </div>
      {showHelp && <p className="mb-1.5 rounded-r-md border-l-2 border-primary bg-primary/10 px-2 py-1.5 text-[11px] leading-snug text-primary">{help}</p>}
      <div className="flex gap-1.5">
        <input value={val} onChange={(e) => setVal(e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" />
        <Button size="sm" disabled={!dirty || saving} onClick={save}>Enregistrer</Button>
      </div>
    </div>
  );
}

export function SystemeScreen() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Record<string, string> | null>(null);
  const [services, setServices] = useState<Record<string, string> | null>(null);
  const [crons, setCrons] = useState<Cron[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ schedule: "0 9 * * *", command: "", name: "" });

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const d = await (await fetch("/api/config", { cache: "no-store" })).json();
      const out: Record<string, string> = {};
      for (const k of Object.keys(d)) if (k && k !== "error") out[k] = Array.isArray(d[k]) ? d[k].join(", ") : String(d[k]);
      setConfig(out);
    } catch { setConfig({}); }
  }, []);
  const loadServices = useCallback(async () => {
    try { setServices(await (await fetch("/api/services", { cache: "no-store" })).json()); } catch { setServices({}); }
  }, []);
  const loadCrons = useCallback(async () => {
    try { const d = await (await fetch("/api/crons", { cache: "no-store" })).json(); setCrons(d.crons || []); } catch { setCrons([]); }
  }, []);

  useEffect(() => { loadConfig(); loadServices(); loadCrons(); }, [loadConfig, loadServices, loadCrons]);

  async function quick(type: "briefing" | "score" | "sync") {
    showToast("Déclenchement…", true);
    try {
      if (type === "score") await fetch("http://147.15.136.49:5678/webhook/m3a-score-trigger");
      else await fetch(type === "briefing" ? "/api/crons/0/trigger" : "/api/crons/2/trigger", { method: "POST" });
      showToast("Lancé ✓", true);
    } catch { showToast("Erreur", false); }
  }
  async function triggerCron(id: number) {
    try { await fetch(`/api/crons/${id}/trigger`, { method: "POST" }); showToast("Tâche déclenchée ✓", true); } catch { showToast("Erreur", false); }
  }
  async function deleteCron(id: number) {
    if (!window.confirm("Supprimer cette tâche planifiée ?")) return;
    try { await fetch(`/api/crons/${id}`, { method: "DELETE" }); showToast("Supprimé", true); loadCrons(); } catch { showToast("Erreur", false); }
  }
  async function addCron() {
    if (!form.schedule.trim() || !form.command.trim()) { showToast("Remplis planification + commande", false); return; }
    try {
      await fetch("/api/crons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      showToast("Tâche ajoutée ✓", true);
      setForm({ schedule: "0 9 * * *", command: "", name: "" });
      loadCrons();
    } catch { showToast("Erreur", false); }
  }

  const sectionTitle = "mb-2.5 text-[10px] font-extrabold tracking-wider text-muted-foreground";

  return (
    <AppShell
      title="Système"
      actions={<Button variant="ghost" size="sm" onClick={() => { loadConfig(); loadServices(); loadCrons(); showToast("Actualisé ✓", true); }}><RefreshCw />Actualiser</Button>}
    >
      <div className="mx-auto max-w-2xl space-y-3.5 p-3.5">
        {/* Configuration */}
        <Card><CardContent>
          <div className={sectionTitle}>CONFIGURATION DE LA COLLECTE</div>
          {!config ? <div className="text-xs text-muted-foreground">Chargement…</div>
            : Object.keys(config).length === 0 ? <div className="text-xs text-muted-foreground">Aucune option dans le Sheet CONFIG.</div>
            : Object.entries(config).map(([k, v]) => <ConfigRow key={k} k={k} value={v} onToast={showToast} />)}
        </CardContent></Card>

        {/* Actions rapides */}
        <Card><CardContent>
          <div className={sectionTitle}>ACTIONS RAPIDES</div>
          <div className="grid grid-cols-2 gap-2">
            <QuickBtn icon={<BarChart3 />} label="Briefing maintenant" onClick={() => quick("briefing")} />
            <QuickBtn icon={<Target />} label="Lancer le scoring" onClick={() => quick("score")} />
            <QuickBtn icon={<RotateCw />} label="Sync Google Sheets" onClick={() => quick("sync")} />
            <QuickBtn icon={<ClipboardList />} label="Voir les offres" onClick={() => navigate("/scoring")} />
          </div>
        </CardContent></Card>

        {/* Services */}
        <Card><CardContent>
          <div className={sectionTitle}>ÉTAT DES SERVICES</div>
          {!services ? <div className="text-xs text-muted-foreground">Chargement…</div>
            : Object.entries(services).map(([name, status]) => {
                const active = status === "active" || /Up/i.test(status);
                const inactive = status === "inactive" || status === "stopped";
                const [nice, sub] = NICE[name] || [name, ""];
                return (
                  <div key={name} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                    <div><div className="text-xs text-foreground">{nice}</div>{sub && <div className="text-[10.5px] text-muted-foreground">{sub}</div>}</div>
                    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", active ? "bg-success/15 text-success" : inactive ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
                      {active ? "● Actif" : inactive ? "○ Arrêté" : String(status).split("\n")[0].slice(0, 18)}
                    </span>
                  </div>
                );
              })}
        </CardContent></Card>

        {/* Avancé — crons */}
        <details className="overflow-hidden rounded-lg border border-border bg-card">
          <summary className="cursor-pointer list-none px-3.5 py-3 text-xs font-bold text-muted-foreground [&::-webkit-details-marker]:hidden">
            <Wrench className="mr-1 inline size-3.5" />Avancé — tâches planifiées (crons)
          </summary>
          <div className="px-3.5 pb-3.5">
            <p className="mb-2.5 flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-[11px] leading-snug text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />Zone technique. Ces tâches tournent seules sur le serveur. Ne modifie que si tu sais ce que tu fais.
            </p>
            {!crons ? <div className="text-xs text-muted-foreground">Chargement…</div>
              : crons.length === 0 ? <div className="text-xs text-muted-foreground">Aucune tâche planifiée.</div>
              : crons.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 border-b border-border py-2 last:border-0">
                    <div className="min-w-0 flex-1"><div className="text-xs text-foreground">{c.name}</div><div className="font-mono text-[11px] text-muted-foreground">{c.schedule}</div></div>
                    <Button variant="secondary" size="sm" onClick={() => triggerCron(c.id)}><Play /></Button>
                    <Button variant="destructive" size="sm" onClick={() => deleteCron(c.id)}><Trash2 /></Button>
                  </div>
                ))}
            <div className="mt-3 space-y-2">
              <FormField label="Planification (cron)" mono value={form.schedule} onChange={(v) => setForm((f) => ({ ...f, schedule: v }))} />
              <FormField label="Commande (chemin absolu)" mono value={form.command} onChange={(v) => setForm((f) => ({ ...f, command: v }))} placeholder="/usr/bin/python3 /home/ubuntu/cockpit/scripts/..." />
              <FormField label="Nom (optionnel)" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Ma tâche" />
              <Button className="w-full" onClick={addCron}>+ Ajouter le cron</Button>
            </div>
          </div>
        </details>
      </div>

      {toast && (
        <div className={cn("fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs text-primary-foreground shadow-lg", toast.ok ? "bg-success" : "bg-destructive")}>{toast.msg}</div>
      )}
    </AppShell>
  );
}

function QuickBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:bg-accent active:opacity-70">
      <span className="text-primary [&_svg]:size-5">{icon}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

function FormField({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={cn("mt-0.5 w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring", mono && "font-mono")} />
    </div>
  );
}
