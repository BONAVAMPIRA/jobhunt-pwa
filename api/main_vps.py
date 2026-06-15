import subprocess, os, json, csv, io, re, hmac, unicodedata, tempfile, shutil, threading, time
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

try:
    import docx_render  # rendu md->docx format TI Quebec (meme dossier que main.py)
except Exception:
    docx_render = None
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, timezone
import urllib.request

app = FastAPI(title="Cockpit API")

# ── Auth (Fix 2 — sprint securite P0, 2026-06-08) ─────────
# L'API est exposee publiquement (Tailscale Funnel). Tout endpoint sauf /health
# exige un Bearer token. Le token est injecte cote serveur par les proxies Vercel
# (jobs.js / chat.js) -> jamais expose au navigateur.
# Fail-closed : si COCKPIT_API_TOKEN n'est pas configure, on refuse tout (503).
API_TOKEN = os.environ.get("COCKPIT_API_TOKEN", "")
PUBLIC_PATHS = {"/health"}

@app.middleware("http")
async def require_bearer(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
        return await call_next(request)
    if not API_TOKEN:
        return JSONResponse({"detail": "API token not configured"}, status_code=503)
    auth = request.headers.get("authorization", "")
    if not hmac.compare_digest(auth, f"Bearer {API_TOKEN}"):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)

# CORS restreint (Fix 3 — sprint securite P0). Defaut = domaine Vercel de prod ;
# surchargeable par env CORS_ALLOWED_ORIGINS (liste separee par des virgules) pour le SaaS.
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "CORS_ALLOWED_ORIGINS", "https://1-pwa.vercel.app").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

HERMES_BIN      = os.path.expanduser("~/.local/bin/hermes")
HERMES_ENV      = {**os.environ, "PATH": f"{os.path.expanduser('~/.local/bin')}:/usr/bin:/bin"}
SHEET_ID        = "15gqqGOb92sfS3nkhNvRrgpssTcfy1fDHDq0OQ34drfw"
JOURNAL_PATH    = Path("/home/ubuntu/cockpit/agents/memory/project_journal.md")
CONFIG_LOCAL    = Path("/home/ubuntu/cockpit/config_overrides.json")
BRIEFING_PATH   = Path("/home/ubuntu/cockpit/briefings/latest.json")
OUTPUT_DIR      = Path("/home/ubuntu/n8n-jobhunt/output")
CANDIDATURES    = OUTPUT_DIR / "candidatures"
MEMORY_PATH     = OUTPUT_DIR / "scoring_memory.json"
N8N_BASE        = "http://localhost:5678/webhook"
# ── CV par offre (B4) : RenderCV tourne sur le VPS dans un venv isolé ──
CV_PIPELINE     = Path("/home/ubuntu/cockpit-sync/cv/pipeline")
CV_VENV_PY      = CV_PIPELINE / ".venv" / "bin" / "python"
CV_RENDERCV     = CV_PIPELINE / ".venv" / "bin" / "rendercv"
CV_VARIANTS     = ("BI", "BA", "Hybride", "Solutions_Affaires", "ERP_CRM", "Power_Platform")
# 1 rendu RenderCV à la fois : Typst+PNG sont gourmands et le VPS est contraint
# (n8n = SPOF sur la même machine). Évite la saturation du threadpool sur appels concurrents.
_CV_RENDER_LOCK = threading.Semaphore(1)

M3C_WEBHOOKS = {
    "cv":      f"{N8N_BASE}/m3c-cv-v2",
    "lm":      f"{N8N_BASE}/m3c-lm-v1",
    "salaire": f"{N8N_BASE}/m3c-salaire-v1",
    "guide":   f"{N8N_BASE}/m3c-guide-v1",
}

# Statuts qui sortent du deck Scoring : pré-scoring + terminaux/gérés ailleurs (Module 4).
# Tout le reste (score, scored, "en attente ...", et tout statut non listé) reste visible
# et triable — pour ne JAMAIS faire disparaître une offre urgente par accident.
DECK_EXCLUDE = {
    "", "a_scorer", "a_pretaiter",
    "genere", "généré", "a_postuler",
    "postule", "postulé", "abandonne", "abandonné",
    "ignore", "ignoré", "expire", "expiré",
    "doublon",                              # doublon masqué (était visible par erreur)
    "entrevue", "offre", "refuse", "refusé",  # funnel post-candidature -> onglet Suivi
}

# Statuts « post-candidature » affichés dans l'onglet Suivi (candidature envoyée et au-delà).
# Le funnel entrevue/offre/refusé est prévu (gros chantier suivi) ; déjà reconnu ici pour
# que tes éditions manuelles dans le Sheet n'atterrissent pas dans le deck par accident.
SUIVI_STATUTS = {"postule", "postulé", "entrevue", "offre", "refuse", "refusé"}

# ── Helpers ──────────────────────────────────────────────

def read_sheet(sheet_name):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={sheet_name}"
    req = urllib.request.Request(url, headers={"User-Agent": "CockpitBot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8")

def parse_gaps(s):
    try:
        return json.loads(s) if s else []
    except:
        return [x.strip() for x in s.split(",") if x.strip()]

def parse_forces(positionnement):
    if not positionnement:
        return []
    skills = re.findall(
        r"\b(Power BI|SQL|BPMN|BABOK|ERP|Agile|Scrum|Python|Tableau|Excel|SAP|"
        r"Salesforce|Jira|Confluence|Azure|AWS|DAX|Power Query|Snowflake|consulting|"
        r"maîtrise|certification|PMP|CBAP|analyse d'affaires|BI)\b",
        positionnement, re.IGNORECASE)
    return list(dict.fromkeys(skills))[:6]

def prio_sort_key(p):
    m = {"A": 1, "B": 2, "C": 3, "D": 4, "P1": 1, "P2": 2, "P3": 3}
    return m.get(str(p).strip().upper(), 99)

def call_n8n(url, job_id):
    payload = json.dumps({"job_id": job_id}).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(url, data=payload,
                headers={"Content-Type": "application/json"}), timeout=10)
        return "déclenché"
    except Exception as e:
        return f"erreur: {str(e)[:60]}"

def set_status(job_id, statut):
    """Pose le statut d'une offre dans SCORED_JOBS via WF-Status-Set (écriture OAuth n8n).
    json.dumps -> ASCII (\\uXXXX) donc les accents passent proprement."""
    payload = json.dumps({"job_id": job_id, "statut": statut}).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(f"{N8N_BASE}/status-set", data=payload,
                headers={"Content-Type": "application/json"}), timeout=20)
        return True
    except Exception:
        return False

def regen_briefing():
    """Régénère le briefing en tâche de fond (non bloquant) pour qu'il reflète
    immédiatement un changement de pipeline (statut modifié)."""
    try:
        subprocess.Popen(["python3", "/home/ubuntu/cockpit/scripts/morning_briefing.py"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def crontab_lines():
    r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return r.stdout.strip().split("\n") if r.stdout.strip() else []

def write_crontab(lines):
    new_ct = "\n".join(lines) + "\n"
    subprocess.run(["crontab", "-"], input=new_ct, text=True)

def guess_variant(positionnement):
    """Devine la variante CV depuis le texte narratif du positionnement de l'offre.
    Défaut sûr = Hybride ; l'utilisateur peut surcharger côté copilote."""
    t = (positionnement or "").lower()
    if any(k in t for k in ("power apps", "power automate", "power platform", "citizen dev")):
        return "Power_Platform"
    if any(k in t for k in ("erp", "crm", "dynamics", "business central", " sap")):
        return "ERP_CRM"
    has_bi = any(k in t for k in ("power bi", "intelligence d'affaires", "dax", "tableau", " bi "))
    has_ba = any(k in t for k in ("analyse d'affaires", "analyste d'affaires", "business analyst", "bpmn", "babok"))
    if has_bi and has_ba:
        return "Hybride"
    if has_ba:
        return "BA"
    if has_bi:
        return "BI"
    return "Hybride"

# ── Endpoints ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}

# ── Jobs / Scoring ──

@app.get("/api/jobs")
def get_jobs():
    try:
        raw = read_sheet("SCORED_JOBS")
        reader = csv.DictReader(io.StringIO(raw))
        jobs = []
        for row in reader:
            statut = (row.get("statut") or "").strip().lower()
            if statut in DECK_EXCLUDE:
                continue
            score = 0
            try:
                score = int(float(row.get("score") or 0))
            except:
                pass
            jobs.append({
                "job_id":         (row.get("job_id") or "").strip(),
                "titre":          (row.get("poste") or "").strip(),
                "entreprise":     (row.get("entreprise") or "").strip(),
                "url":            (row.get("url") or "").strip(),
                "score":          score,
                "forces":         parse_forces(row.get("positionnement", "")),
                "gaps":           parse_gaps(row.get("gaps_json", "")),
                "priorite":       (row.get("priorite") or "").strip(),
                "deadline":       (row.get("deadline") or "").strip(),
                "date_collecte":  (row.get("date_publication") or row.get("date") or "").strip(),
                "positionnement": (row.get("positionnement") or "").strip()[:300],
                "recommandation": (row.get("recommandation") or "").strip(),
            })
        jobs.sort(key=lambda j: (prio_sort_key(j["priorite"]), -j["score"]))
        return {"jobs": jobs, "total": len(jobs), "source": "google_sheets"}
    except Exception as e:
        return {"jobs": [], "total": 0, "error": str(e)}

@app.get("/api/briefing")
def get_briefing():
    try:
        return json.loads(BRIEFING_PATH.read_text())
    except:
        return {"error": "Briefing non disponible — sera généré à 08h00"}

@app.get("/api/status")
def get_status():
    status = {"services": {}, "sheets": {}, "git": ""}
    try:
        r = subprocess.run(["git", "-C", "/home/ubuntu/jobhunt", "log", "--oneline", "-5"],
                           capture_output=True, text=True, timeout=5)
        status["git"] = r.stdout.strip()
    except:
        pass
    try:
        for svc in ["hermes-gateway", "cockpit-api", "syncthing"]:
            r = subprocess.run(["systemctl", "--user", "is-active", svc],
                               capture_output=True, text=True, timeout=3)
            status["services"][svc] = r.stdout.strip()
    except:
        pass
    try:
        raw = read_sheet("SCORED_JOBS")
        rows = list(csv.DictReader(io.StringIO(raw)))
        stats = {}
        for row in rows:
            s = (row.get("statut") or "inconnu").strip().lower()
            stats[s] = stats.get(s, 0) + 1
        status["sheets"] = stats
        status["total_offres"] = len(rows)
    except Exception as e:
        status["sheets_error"] = str(e)
    return status

# ── Docs generation ──

class GenerateDocsRequest(BaseModel):
    job_id: str
    docs: list[str] = ["cv", "lm", "salaire", "guide"]

@app.post("/api/generate-docs")
def generate_docs(req: GenerateDocsRequest):
    results = {}
    for doc in req.docs:
        if doc in M3C_WEBHOOKS:
            results[doc] = call_n8n(M3C_WEBHOOKS[doc], req.job_id)
    launched = [d for d, s in results.items() if s == "déclenché"]
    return {"job_id": req.job_id, "results": results, "launched": launched, "eta_seconds": 120}

@app.get("/api/docs-status")
def docs_status(job_id: str):
    docs = {}
    try:
        for company_dir in os.listdir(str(CANDIDATURES)):
            cp = CANDIDATURES / company_dir
            if not cp.is_dir():
                continue
            for job_dir in os.listdir(str(cp)):
                jp = cp / job_dir
                if not jp.is_dir():
                    continue
                for f in os.listdir(str(jp)):
                    if f.startswith("CV_"):
                        docs["cv"] = f
                    elif f.startswith("LM_"):
                        docs["lm"] = f
                    elif f.startswith("Sala"):
                        docs["salaire"] = f
                    elif f.startswith("Guid"):
                        docs["guide"] = f
    except:
        pass
    return {"job_id": job_id, "docs": docs, "ready": len(docs) >= 4}

class JobAction(BaseModel):
    job_id: str
    action: str

@app.post("/api/job-action")
def job_action(req: JobAction):
    docs_launched = []
    statut = None
    if req.action == "postuler":          # bouton "Générer" : lance les 4 docs + statut -> généré
        for doc, url in M3C_WEBHOOKS.items():
            if call_n8n(url, req.job_id) == "déclenché":
                docs_launched.append(doc)
        statut = "généré"
        set_status(req.job_id, statut)
    elif req.action in ("abandonner", "ignorer"):
        statut = "abandonné"
        set_status(req.job_id, statut)
    elif req.action in ("expirer", "expire"):  # offre découverte expirée au moment de postuler
        statut = "expiré"
        set_status(req.job_id, statut)
    # "contester" : pas de changement de statut ici (géré par /api/rescore)
    if statut:
        regen_briefing()
    return {"ok": True, "job_id": req.job_id, "action": req.action,
            "statut": statut, "docs_launched": docs_launched}

class RescoreRequest(BaseModel):
    job_id: str
    comment: str

# Re-scoring asynchrone : l'appel WF-M3d-Rescore (Claude Sonnet) dure 20-60 s,
# au-delà du timeout des fonctions Vercel (~25 s) -> le PWA recevait une erreur.
# On découple : /api/rescore lance le travail en tâche de fond et répond tout de
# suite ; le PWA sonde /api/rescore-result jusqu'à ce que le score révisé arrive.
_RESCORE_RESULTS = {}     # job_id -> dict résultat du WF (ou {"error": ...})
_RESCORE_PENDING = set()  # job_id dont la révision est en cours

def _store_rescore(job_id, result):
    # Garde-fou anti-fuite : purge les résultats jamais lus de plus de 10 min.
    now = time.time()
    for k in [k for k, v in list(_RESCORE_RESULTS.items()) if now - v.get("_ts", now) > 600]:
        _RESCORE_RESULTS.pop(k, None)
    result["_ts"] = now
    _RESCORE_RESULTS[job_id] = result

def _run_rescore(job_id, comment):
    url = f"{N8N_BASE}/m3d-rescore"
    payload = json.dumps({"job_id": job_id, "comment": comment}).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, data=payload,
                headers={"Content-Type": "application/json"}), timeout=120) as r:
            body = r.read().decode("utf-8")
        try:
            _store_rescore(job_id, json.loads(body))
        except Exception:
            _store_rescore(job_id, {"ok": False, "raw": body[:300]})
    except Exception as e:
        _store_rescore(job_id, {"error": f"rescore failed: {str(e)[:120]}"})
    finally:
        _RESCORE_PENDING.discard(job_id)

@app.post("/api/rescore")
def rescore(req: RescoreRequest):
    """Contestation d'un score : relaie vers WF-M3d-Rescore (n8n a l'OAuth Sheets en écriture).
    Asynchrone : lance la révision en tâche de fond et répond immédiatement.
    Le PWA récupère le résultat via /api/rescore-result?job_id=..."""
    _RESCORE_RESULTS.pop(req.job_id, None)
    _RESCORE_PENDING.add(req.job_id)
    threading.Thread(target=_run_rescore, args=(req.job_id, req.comment), daemon=True).start()
    return {"ok": True, "pending": True, "job_id": req.job_id}

@app.get("/api/rescore-result")
def rescore_result(job_id: str):
    """Renvoie le résultat du re-scoring si prêt (et le consomme), sinon l'état d'attente."""
    if job_id in _RESCORE_RESULTS:
        return {"ready": True, "result": _RESCORE_RESULTS.pop(job_id)}
    return {"ready": False, "pending": job_id in _RESCORE_PENDING}

# ── Services & Crons ──

@app.get("/api/services")
def get_services():
    services = {}
    for svc in ["hermes-gateway", "cockpit-api", "syncthing"]:
        try:
            r = subprocess.run(["systemctl", "--user", "is-active", svc],
                               capture_output=True, text=True, timeout=3)
            services[svc] = r.stdout.strip()
        except:
            services[svc] = "unknown"
    try:
        r = subprocess.run(["docker", "ps", "--filter", "name=n8n-jobhunt",
                            "--format", "{{.Status}}"],
                           capture_output=True, text=True, timeout=3)
        services["n8n-jobhunt"] = r.stdout.strip() or "stopped"
    except:
        services["n8n-jobhunt"] = "unknown"
    return services

# ── Securite crons (sprint P0) : verrouiller la CREATION/EDITION ────────────
# Sans ca, un appel authentifie pouvait ecrire n'importe quelle commande dans le
# crontab puis la declencher = RCE. On n'autorise que : planning cron valide (5
# champs), aucune metacaractere shell, et des commandes qui pointent vers des
# repertoires connus du projet.
ALLOWED_CRON_DIRS = ("/home/ubuntu/cockpit/", "/home/ubuntu/cockpit-sync/",
                     "/home/ubuntu/n8n-jobhunt/")
ALLOWED_CRON_BINS = ("/usr/bin/python3", "python3", "/bin/bash", "bash", "/bin/sh", "sh")
_CRON_SCHEDULE_RE = re.compile(r"^[\d*/,\-]+(\s+[\d*/,\-]+){4}$")
_CRON_FORBIDDEN_RE = re.compile(r"[;&|`$<>(){}\\\n\r]")

def _validate_cron_schedule(schedule: str):
    if not _CRON_SCHEDULE_RE.match((schedule or "").strip()):
        raise HTTPException(status_code=400,
                            detail="Planning cron invalide (5 champs: min heure jour mois jour-semaine)")

def _validate_cron_command(command: str):
    command = (command or "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="Commande vide")
    if _CRON_FORBIDDEN_RE.search(command):
        raise HTTPException(status_code=400,
                            detail="Commande refusee : metacaractere shell interdit (; & | $ ` < > ...)")
    tokens = command.split()
    if tokens[0] not in ALLOWED_CRON_BINS and not tokens[0].startswith(ALLOWED_CRON_DIRS):
        raise HTTPException(status_code=400, detail="Commande refusee : binaire non autorise")
    # tout chemin absolu cite doit etre sous un repertoire autorise
    # (on saute les interpreteurs connus comme /usr/bin/python3)
    for p in re.findall(r"/\S+", command):
        if p in ALLOWED_CRON_BINS:
            continue
        if not p.startswith(ALLOWED_CRON_DIRS):
            raise HTTPException(status_code=400, detail=f"Commande refusee : chemin non autorise ({p})")

@app.get("/api/crons")
def list_crons():
    lines = crontab_lines()
    non_comment = [l for l in lines if l.strip() and not l.startswith("#")]
    crons = []
    names = {
        "morning_briefing": "Briefing matinal",
        "auto_score": "Auto-scoring",
        "sync_scores": "Sync Google Sheets",
    }
    for i, line in enumerate(non_comment):
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        schedule = " ".join(parts[:5])
        command = parts[5]
        name = next((v for k, v in names.items() if k in command), command.split("/")[-1][:40])
        crons.append({"id": i, "schedule": schedule, "command": command, "name": name})
    return {"crons": crons}

class CronAdd(BaseModel):
    schedule: str
    command: str
    name: str = ""

@app.post("/api/crons")
def add_cron(req: CronAdd):
    _validate_cron_schedule(req.schedule)
    _validate_cron_command(req.command)
    lines = crontab_lines()
    new_line = f"{req.schedule.strip()} {req.command.strip()}"
    lines.append(new_line)
    write_crontab(lines)
    return {"ok": True, "added": new_line}

class CronUpdate(BaseModel):
    schedule: str

@app.put("/api/crons/{cron_id}")
def update_cron(cron_id: int, req: CronUpdate):
    _validate_cron_schedule(req.schedule)
    lines = crontab_lines()
    non_comment = [l for l in lines if l.strip() and not l.startswith("#")]
    if cron_id >= len(non_comment):
        raise HTTPException(status_code=404, detail="Cron introuvable")
    old_line = non_comment[cron_id]
    old_cmd = " ".join(old_line.split(None, 5)[5:])
    new_line = f"{req.schedule} {old_cmd}"
    new_lines = []
    replaced = False
    for l in lines:
        if l == old_line and not replaced:
            new_lines.append(new_line)
            replaced = True
        else:
            new_lines.append(l)
    write_crontab(new_lines)
    return {"ok": True, "old_schedule": " ".join(old_line.split(None, 5)[:5]), "new": new_line}

@app.delete("/api/crons/{cron_id}")
def delete_cron(cron_id: int):
    lines = crontab_lines()
    non_comment = [l for l in lines if l.strip() and not l.startswith("#")]
    if cron_id >= len(non_comment):
        raise HTTPException(status_code=404, detail="Cron introuvable")
    line_to_remove = non_comment[cron_id]
    new_lines = [l for l in lines if l != line_to_remove]
    write_crontab(new_lines)
    return {"ok": True, "removed": line_to_remove}

@app.post("/api/crons/{cron_id}/trigger")
def trigger_cron(cron_id: int):
    lines = crontab_lines()
    non_comment = [l for l in lines if l.strip() and not l.startswith("#")]
    if cron_id >= len(non_comment):
        raise HTTPException(status_code=404, detail="Cron introuvable")
    command = " ".join(non_comment[cron_id].split(None, 5)[5:])
    # NB : ces crons existent deja dans le crontab et peuvent utiliser de la
    # syntaxe shell (cd, &&, redirections) -> on garde shell=True ICI (on ne fait
    # que relancer une ligne deja presente). Le durcissement RCE se fait en amont,
    # sur la CREATION de cron (POST /api/crons), pas sur le declenchement.
    subprocess.Popen(command, shell=True)
    return {"ok": True, "triggered": command}

# ── Config ──

@app.get("/api/config")
def get_config():
    try:
        raw = read_sheet("CONFIG")
        items = {}
        for row in csv.DictReader(io.StringIO(raw)):
            k = (row.get("key") or "").strip()
            v = (row.get("value") or "").strip()
            if not k:
                continue
            if k in items:
                existing = items[k]
                if isinstance(existing, list):
                    existing.append(v)
                else:
                    items[k] = [existing, v]
            else:
                items[k] = v
        try:
            overrides = json.loads(CONFIG_LOCAL.read_text())
            items.update(overrides)
        except:
            pass
        return items
    except Exception as e:
        return {"error": str(e)}

class ConfigUpdate(BaseModel):
    key: str
    value: str

@app.post("/api/config")
def update_config(req: ConfigUpdate):
    try:
        overrides = json.loads(CONFIG_LOCAL.read_text())
    except:
        overrides = {}
    overrides[req.key] = req.value
    CONFIG_LOCAL.write_text(json.dumps(overrides, ensure_ascii=False, indent=2))
    return {"ok": True, "key": req.key, "value": req.value}

# ── Journal ──

@app.get("/api/journal")
def get_journal():
    try:
        content = JOURNAL_PATH.read_text()
        entries = []
        current = None
        for line in content.split("\n"):
            if line.startswith("## "):
                if current:
                    entries.append(current)
                current = {"title": line[3:], "body": []}
            elif current and line.strip():
                current["body"].append(line)
        if current:
            entries.append(current)
        entries.reverse()
        return {"entries": [{"title": e["title"], "body": "\n".join(e["body"])} for e in entries[:20]],
                "total": len(entries)}
    except:
        return {"entries": [], "total": 0}

class JournalEntry(BaseModel):
    content: str
    author: str = "Claude"

@app.post("/api/journal")
def add_journal(req: JournalEntry):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = f"\n## {now} — {req.author}\n\n{req.content}\n"
    with open(str(JOURNAL_PATH), "a") as f:
        f.write(entry)
    return {"ok": True}

# ── Module 4 : Candidature ──────────────────────────────
# Dossier canonique unique par candidature : candidatures/<slug_co>/<slug_role>/
# contenant les .md (source, generes par M3c) + les .docx (a la demande, ce module).

PROFILE_JSON = OUTPUT_DIR / "profile.json"
DOC_PREFIX = {"cv": "CV", "lm": "LM", "salaire": "Salaire", "guide": "Guide"}
GENERE_STATUTS = {"genere", "généré"}

def slugify(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()

def candidature_dir(entreprise, poste):
    return CANDIDATURES / slugify(entreprise) / slugify(poste)

def doc_md_path(entreprise, poste, doc_type):
    base = f"{slugify(entreprise)}_{slugify(poste)}"
    return candidature_dir(entreprise, poste) / f"{DOC_PREFIX[doc_type]}_{base}.md"

def row_for_job(job_id):
    raw = read_sheet("SCORED_JOBS")
    for row in csv.DictReader(io.StringIO(raw)):
        if (row.get("job_id") or "").strip() == job_id:
            return row
    return None

@app.get("/api/postuler-jobs")
def postuler_jobs():
    """Offres au statut 'genere' : docs prets, en attente de candidature."""
    try:
        raw = read_sheet("SCORED_JOBS")
        out = []
        for row in csv.DictReader(io.StringIO(raw)):
            if (row.get("statut") or "").strip().lower() not in GENERE_STATUTS:
                continue
            entreprise = (row.get("entreprise") or "").strip()
            poste = (row.get("poste") or "").strip()
            docs = {t: doc_md_path(entreprise, poste, t).exists() for t in DOC_PREFIX}
            score = 0
            try:
                score = int(float(row.get("score") or 0))
            except Exception:
                pass
            out.append({
                "job_id": (row.get("job_id") or "").strip(),
                "poste": poste, "entreprise": entreprise,
                "url": (row.get("url") or "").strip(),
                "score": score,
                "deadline": (row.get("deadline") or "").strip(),
                "docs": docs,
                "docs_ready": all(docs.values()),
            })
        out.sort(key=lambda j: -j["score"])
        return {"jobs": out, "total": len(out)}
    except Exception as e:
        return {"jobs": [], "total": 0, "error": str(e)}

# Extrait la prétention (chiffre cible / plancher) de l'analyse salariale .md, pour
# l'afficher d'un coup d'œil dans le Suivi (le truc qui a manqué lors de l'appel RANDSTAD).
def parse_salaire_md(md):
    cible = plancher = ""
    if not md:
        return cible, plancher
    for line in md.splitlines():
        low = line.lower()
        m = re.search(r"(\d[\d  .,  ]*\s*\$)", line)
        if not m:
            continue
        val = re.sub(r"\s+", " ", m.group(1)).strip()
        if not cible and "cible" in low:
            cible = val
        elif not plancher and "plancher" in low:
            plancher = val
    return cible, plancher

@app.get("/api/suivi")
def suivi_jobs():
    """Offres post-candidature (statut 'postulé' et au-delà) : suivi + dossier + prétention."""
    try:
        raw = read_sheet("SCORED_JOBS")
        out = []
        for row in csv.DictReader(io.StringIO(raw)):
            if (row.get("statut") or "").strip().lower() not in SUIVI_STATUTS:
                continue
            entreprise = (row.get("entreprise") or "").strip()
            poste = (row.get("poste") or "").strip()
            docs = {t: doc_md_path(entreprise, poste, t).exists() for t in DOC_PREFIX}
            cible = plancher = ""
            sp = doc_md_path(entreprise, poste, "salaire")
            if sp.exists():
                try:
                    cible, plancher = parse_salaire_md(sp.read_text(encoding="utf-8"))
                except Exception:
                    pass
            score = 0
            try:
                score = int(float(row.get("score") or 0))
            except Exception:
                pass
            out.append({
                "job_id": (row.get("job_id") or "").strip(),
                "poste": poste, "entreprise": entreprise,
                "url": (row.get("url") or "").strip(),
                "statut": (row.get("statut") or "").strip().lower(),
                "score": score,
                "date": (row.get("date_depot") or row.get("date_candidature") or row.get("date") or "").strip(),
                "salaire_cible": cible, "salaire_plancher": plancher,
                "docs": docs, "docs_ready": all(docs.values()),
            })
        out.sort(key=lambda j: (j["entreprise"].lower(), j["poste"].lower()))
        return {"jobs": out, "total": len(out)}
    except Exception as e:
        return {"jobs": [], "total": 0, "error": str(e)}

@app.get("/api/doc")
def get_doc(job_id: str, type: str, format: str = "md"):
    """Sert un document de candidature. format=md -> texte ; format=docx -> fichier (genere a la demande)."""
    type = (type or "").lower()
    if type not in DOC_PREFIX:
        raise HTTPException(status_code=400, detail="type invalide (cv|lm|salaire|guide)")
    row = row_for_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="job_id introuvable")
    entreprise = (row.get("entreprise") or "").strip()
    poste = (row.get("poste") or "").strip()
    md_path = doc_md_path(entreprise, poste, type)
    if not md_path.exists():
        raise HTTPException(status_code=404, detail=f"document {type} introuvable pour cette offre")

    if format == "md":
        return JSONResponse({"job_id": job_id, "type": type,
                             "content": md_path.read_text(encoding="utf-8")})
    if format == "docx":
        if docx_render is None:
            raise HTTPException(status_code=503, detail="generateur docx indisponible (python-docx manquant)")
        buf = io.BytesIO()                       # rendu en memoire -> pas d'ecriture disque (perm. opc/ubuntu)
        docx_render.render(md_path.read_text(encoding="utf-8"), buf, type)
        buf.seek(0)
        fname = f"{DOC_PREFIX[type]}_Jaona_Rabaonarison_{slugify(entreprise)}_{slugify(poste)}.docx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    raise HTTPException(status_code=400, detail="format invalide (md|docx)")

# Pipeline CV en 2 temps (B4 + édition) :
#   _cv_build_yaml : vault Obsidian + offre -> texte master_cv.yaml tailoré (éditable).
#   _cv_render_yaml : texte YAML (édité ou non) -> PDF RenderCV. Verrou 1-rendu-à-la-fois.
def _cv_build_yaml(row, variant):
    if not CV_VENV_PY.exists():
        raise HTTPException(status_code=503, detail="pipeline CV indisponible (venv RenderCV absent)")
    if variant == "auto":
        variant = guess_variant(row.get("positionnement"))
    if variant not in CV_VARIANTS:
        raise HTTPException(status_code=400, detail=f"variant invalide (auto|{'|'.join(CV_VARIANTS)})")
    # B4.2 — texte de l'offre pour cibler compétences + mandats (tronqué, borné).
    offer_text = " ".join(str(row.get(k) or "") for k in
                          ("poste", "positionnement", "offer_mission", "offer_qualif",
                           "offer_contexte", "offer_autres"))[:4000]
    env = {**os.environ, "PYTHONUTF8": "1"}
    work = Path(tempfile.mkdtemp(prefix="cvyaml_"))
    try:
        seed = CV_PIPELINE / "master_cv.yaml"           # thème TI Québec calibré préservé par le sync
        yaml_path = work / "master_cv.yaml"
        if seed.exists():
            shutil.copy(seed, yaml_path)
        subprocess.run([str(CV_VENV_PY), str(CV_PIPELINE / "sync_cv_from_obsidian.py"),
                        "--variant", variant, "--out", str(yaml_path), "--offer", offer_text],
                       cwd=str(work), env=env, check=True, capture_output=True, timeout=60)
        return yaml_path.read_text(encoding="utf-8"), variant
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", "replace")[-300:]
        raise HTTPException(status_code=500, detail=f"préparation CV échouée : {err}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="préparation CV : délai dépassé")
    finally:
        shutil.rmtree(work, ignore_errors=True)

def _cv_render_yaml(yaml_text):
    if not CV_RENDERCV.exists():
        raise HTTPException(status_code=503, detail="pipeline CV indisponible (venv RenderCV absent)")
    if not _CV_RENDER_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="génération CV déjà en cours, réessaie dans un instant")
    work = None
    try:
        env = {**os.environ, "PYTHONUTF8": "1"}
        work = Path(tempfile.mkdtemp(prefix="cvpdf_"))   # dans le try : si ça échoue, le lock est quand même relâché
        yaml_path = work / "master_cv.yaml"
        yaml_path.write_text(yaml_text, encoding="utf-8")
        subprocess.run([str(CV_RENDERCV), "render", str(yaml_path)],
                       cwd=str(work), env=env, check=True, capture_output=True, timeout=180)
        pdfs = list((work / "rendercv_output").glob("*.pdf"))
        if not pdfs:
            raise HTTPException(status_code=500, detail="rendu RenderCV : aucun PDF produit")
        return pdfs[0].read_bytes()
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", "replace")[-400:]
        raise HTTPException(status_code=400, detail=f"YAML invalide / rendu échoué : {err}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="génération CV : délai dépassé")
    finally:
        if work:
            shutil.rmtree(work, ignore_errors=True)
        _CV_RENDER_LOCK.release()

@app.get("/api/cv-pdf")
def cv_pdf(job_id: str, variant: str = "auto"):
    """B4 — CV PDF (RenderCV, TI Québec) ciblé pour une offre, généré direct depuis le vault."""
    row = row_for_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="job_id introuvable")
    yaml_text, variant = _cv_build_yaml(row, variant)
    data = _cv_render_yaml(yaml_text)
    fname = f"CV_Jaona_Rabaonarison_{slugify(row.get('entreprise') or '')}_{slugify(row.get('poste') or '')}.pdf"
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"',
                                      "X-CV-Variant": variant})

@app.get("/api/cv-yaml")
def cv_yaml(job_id: str, variant: str = "auto"):
    """Texte YAML RenderCV tailoré pour l'offre, à éditer côté copilote avant rendu."""
    row = row_for_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="job_id introuvable")
    yaml_text, variant = _cv_build_yaml(row, variant)
    return {"job_id": job_id, "variant": variant, "yaml": yaml_text}

class CvRender(BaseModel):
    yaml: str

@app.post("/api/cv-render")
def cv_render(req: CvRender):
    """Rend le CV PDF depuis un YAML édité (fourni par le copilote)."""
    if not req.yaml or len(req.yaml) > 200000:
        raise HTTPException(status_code=400, detail="YAML vide ou trop volumineux")
    data = _cv_render_yaml(req.yaml)
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="CV.pdf"'})

@app.get("/api/perso")
def get_perso():
    """Infos perso depuis le profil (export du Vault Obsidian)."""
    try:
        data = json.loads(PROFILE_JSON.read_text(encoding="utf-8"))
        return data.get("identite", {})
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/profil")
def get_profil():
    """Profil complet (export Vault) pour le copilote de candidature : champs granulaires
    (identite, experiences eclatees, formations, certifications, competences)."""
    try:
        data = json.loads(PROFILE_JSON.read_text(encoding="utf-8"))
        keys = ("identite", "experiences", "formations", "certifications",
                "competences", "realisations_cles", "positionnements_cv")
        return {k: data.get(k) for k in keys if k in data}
    except Exception as e:
        return {"error": str(e)}

class MarkPostule(BaseModel):
    job_id: str
    canal: str = ""

@app.post("/api/mark-postule")
def mark_postule(req: MarkPostule):
    ok = set_status(req.job_id, "postulé")
    if ok:
        regen_briefing()
    return {"ok": ok, "job_id": req.job_id, "statut": "postulé" if ok else None}

# ── Hermes chat ──

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None

class ChatResponse(BaseModel):
    response: str
    session_id: str

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    cmd = [HERMES_BIN, "chat", "-q", req.message, "--max-turns", "1", "-Q"]
    if req.session_id:
        cmd += ["--resume", req.session_id]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=HERMES_ENV)
        output = result.stdout.strip()
        session_id = ""
        response_lines = []
        for line in output.split("\n"):
            if line.startswith("session_id:"):
                session_id = line.split("session_id:")[-1].strip()
            elif line.strip():
                response_lines.append(line)
        response = "\n".join(response_lines).strip() or "Pas de réponse"
        return ChatResponse(response=response, session_id=session_id)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
