import subprocess, os, json, csv, io, re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, timezone
import urllib.request

app = FastAPI(title="Cockpit API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

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
TELEGRAM_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT   = os.environ.get("TELEGRAM_CHAT_ID", "6075696502")

M3C_WEBHOOKS = {
    "cv":      f"{N8N_BASE}/m3c-cv-v2",
    "lm":      f"{N8N_BASE}/m3c-lm-v1",
    "salaire": f"{N8N_BASE}/m3c-salaire-v1",
    "guide":   f"{N8N_BASE}/m3c-guide-v1",
}

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

def crontab_lines():
    r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return r.stdout.strip().split("\n") if r.stdout.strip() else []

def write_crontab(lines):
    new_ct = "\n".join(lines) + "\n"
    subprocess.run(["crontab", "-"], input=new_ct, text=True)

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
            if statut not in ("score", "scored", "a_postuler"):
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
    statut_map = {"postuler": "a_postuler", "ignorer": "ignoré", "contester": "score"}
    nouveau_statut = statut_map.get(req.action, req.action)
    docs_launched = []
    if req.action == "postuler":
        for doc, url in M3C_WEBHOOKS.items():
            if call_n8n(url, req.job_id) == "déclenché":
                docs_launched.append(doc)
    return {"ok": True, "job_id": req.job_id, "action": req.action,
            "statut": nouveau_statut, "docs_launched": docs_launched}

class RescoreRequest(BaseModel):
    job_id: str
    comment: str

@app.post("/api/rescore")
def rescore(req: RescoreRequest):
    """Contestation d'un score : relaie vers WF-M3d-Rescore (n8n a l'OAuth Sheets en écriture).
    Claude révise le score à la lumière du commentaire, met à jour SCORED_JOBS + scoring_memory.json."""
    url = f"{N8N_BASE}/m3d-rescore"
    payload = json.dumps({"job_id": req.job_id, "comment": req.comment}).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, data=payload,
                headers={"Content-Type": "application/json"}), timeout=90) as r:
            body = r.read().decode("utf-8")
        try:
            return json.loads(body)
        except Exception:
            return {"ok": False, "raw": body[:300]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"rescore failed: {str(e)[:120]}")

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
    lines = crontab_lines()
    new_line = f"{req.schedule} {req.command}"
    lines.append(new_line)
    write_crontab(lines)
    return {"ok": True, "added": new_line}

class CronUpdate(BaseModel):
    schedule: str

@app.put("/api/crons/{cron_id}")
def update_cron(cron_id: int, req: CronUpdate):
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
