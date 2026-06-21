import { useEffect, useRef, useState, type ReactNode } from "react";
import { Send, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { renderMarkdown, extractHermesTask } from "@/lib/markdown";

type Mode = "claude" | "hermes";
type Role = "user" | "claude" | "hermes" | "system";
interface Msg {
  id: string;
  role: Role;
  content: string;
  md?: boolean;
  streaming?: boolean;
  relayTask?: string | null;
  relayedTask?: boolean;
  backToClaude?: { task: string; result: string };
  backDone?: boolean;
}
interface HistItem { role: "user" | "assistant"; content: string }

const uid = () => Math.random().toString(36).slice(2);
const COST_WARN = 0.5, COST_DANGER = 1.0;
const fmtUSD = (n: number) => (n < 0.01 ? n.toFixed(3) : n.toFixed(2)).replace(".", ",") + " $";

export function ChatScreen() {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("chat_mode") as Mode) || "claude");
  const [claudeMsgs, setClaudeMsgs] = useState<Msg[]>([{ id: "i", role: "system", content: "Claude Sonnet — même contexte que le CLI. Continue le projet depuis ton téléphone." }]);
  const [hermesMsgs, setHermesMsgs] = useState<Msg[]>([{ id: "i", role: "system", content: "Hermes Agent — exécute tes tâches sur le VPS. La réponse arrive dès qu'il a fini." }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [cost, setCost] = useState(() => parseFloat(sessionStorage.getItem("chat_cost") || "0"));
  const [lastCost, setLastCost] = useState(0);
  const [wait, setWait] = useState(0);

  const history = useRef<HistItem[]>(JSON.parse(sessionStorage.getItem("history_claude") || "[]"));
  const hermesSession = useRef<string | null>(sessionStorage.getItem("hermes_session"));
  const scrollRef = useRef<HTMLDivElement>(null);

  const msgs = mode === "claude" ? claudeMsgs : hermesMsgs;

  useEffect(() => { localStorage.setItem("chat_mode", mode); }, [mode]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [claudeMsgs, hermesMsgs, wait]);

  function recordCost(c: number) {
    if (!isFinite(c)) return;
    setLastCost(c);
    setCost((prev) => { const next = prev + c; sessionStorage.setItem("chat_cost", String(next)); return next; });
  }
  const patch = (setter: typeof setClaudeMsgs, id: string, p: Partial<Msg>) =>
    setter((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)));

  async function sendClaude(text: string, displayNote?: string) {
    setClaudeMsgs((l) => [...l, { id: uid(), role: displayNote ? "system" : "user", content: displayNote ?? text }]);
    const botId = uid();
    setClaudeMsgs((l) => [...l, { id: botId, role: "claude", content: "", streaming: true }]);
    let full = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.current, mode: "claude" }),
      });
      if (!res.ok || !res.body) throw new Error("Erreur serveur");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            if (evt.token) { full += evt.token; patch(setClaudeMsgs, botId, { content: full }); }
            else if (typeof evt.cost === "number") recordCost(evt.cost);
          } catch { /* ignore */ }
        }
      }
      const { displayText, task } = extractHermesTask(full);
      patch(setClaudeMsgs, botId, { content: displayText, md: true, streaming: false, relayTask: task });
      history.current.push({ role: "user", content: text });
      history.current.push({ role: "assistant", content: full });
      if (history.current.length > 30) history.current.splice(0, 2);
      sessionStorage.setItem("history_claude", JSON.stringify(history.current));
    } catch (e) {
      patch(setClaudeMsgs, botId, { content: "Erreur : " + (e instanceof Error ? e.message : String(e)), streaming: false });
    }
  }

  async function sendHermes(text: string) {
    setHermesMsgs((l) => [...l, { id: uid(), role: "user", content: text }]);
    setWait(1);
    const timer = setInterval(() => setWait((w) => w + 1), 1000);
    const stop = () => { clearInterval(timer); setWait(0); };
    const sys = (m: string) => setHermesMsgs((l) => [...l, { id: uid(), role: "system", content: m }]);
    try {
      const start = await (await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: hermesSession.current, mode: "hermes" }),
      })).json();
      if (start?.response && !start.request_id) { stop(); return renderHermes(text, start); }
      if (!start?.request_id) { stop(); return sys("Hermes : " + (start?.detail || "pas de réponse.")); }
      const deadline = Date.now() + 125000;
      let data: any = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        data = await (await fetch("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "hermes", poll_id: start.request_id }),
        })).json();
        if (data.status === "done") break;
        if (data.status === "error") { stop(); return sys("Hermes : " + (data.detail || "erreur")); }
      }
      stop();
      if (!data || data.status !== "done") return sys("Hermes met trop de temps à répondre. Réessaie.");
      renderHermes(text, data);
    } catch {
      stop();
      sys("Hermes inaccessible. Essaie le mode Claude.");
    }
  }

  function renderHermes(task: string, data: any) {
    if (data.session_id) { hermesSession.current = data.session_id; sessionStorage.setItem("hermes_session", data.session_id); }
    const result = data.response || "Pas de réponse.";
    setHermesMsgs((l) => [...l, { id: uid(), role: "hermes", content: result, md: true, backToClaude: { task, result } }]);
  }

  async function relayToClaude(task: string, result: string, id: string) {
    patch(setHermesMsgs, id, { backDone: true });
    setMode("claude");
    setSending(true);
    await sendClaude(
      `Hermes (les mains sur le VPS) a exécuté cette tâche :\n« ${task} »\n\nRésultat obtenu :\n${result}\n\nAnalyse ce résultat et dis-moi la prochaine étape. Si une nouvelle action VPS est nécessaire, émets un nouveau tag [HERMES: ...].`,
      "↩ Résultat d'Hermes transmis à Claude"
    );
    setSending(false);
  }

  async function sendToHermes(task: string, id: string) {
    patch(setClaudeMsgs, id, { relayedTask: true });
    setClaudeMsgs((l) => [...l, { id: uid(), role: "system", content: "📤 Tâche transmise à Hermes : " + task }]);
    setMode("hermes");
    setSending(true);
    await sendHermes(task);
    setSending(false);
  }

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || sending) return;
    if (!text) setInput("");
    setSending(true);
    if (mode === "claude") await sendClaude(t); else await sendHermes(t);
    setSending(false);
  }

  async function quick(prompt: string) {
    setMode("claude");
    setSending(true);
    await sendClaude(prompt);
    setSending(false);
  }

  const costCls = cost >= COST_DANGER ? "text-destructive font-bold" : cost >= COST_WARN ? "text-warning" : "text-muted-foreground";

  return (
    <AppShell
      title={mode === "claude" ? "Claude" : "Hermes"}
      actions={
        <div className="flex rounded-full border border-border bg-background p-0.5">
          {(["claude", "hermes"] as Mode[]).map((m) => (
            <button key={m} data-testid={`mode-${m}`} onClick={() => setMode(m)}
              className={cn("rounded-full px-3 py-1 text-[11px] font-bold capitalize transition-colors",
                mode === m ? (m === "claude" ? "bg-primary text-primary-foreground" : "bg-success text-primary-foreground") : "text-muted-foreground")}>
              {m}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div className={cn("flex items-center gap-1.5 border-b border-border bg-background px-3.5 py-1 text-[10px]", costCls)}>
          {mode === "hermes" ? "🟢 Hermes — gratuit (0 $)" : (
            <>
              💰 Session ≈ {fmtUSD(cost)}{lastCost ? ` · dernier ${fmtUSD(lastCost)}` : ""}
              <button onClick={() => { setCost(0); setLastCost(0); sessionStorage.setItem("chat_cost", "0"); }} className="ml-auto underline">remettre à zéro</button>
            </>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-3.5" data-testid="thread">
          {msgs.map((m) => <MsgBubble key={m.id} m={m} onRelay={sendToHermes} onBack={relayToClaude} />)}
          {wait > 0 && mode === "hermes" && (
            <div className="flex items-center gap-2 self-start rounded-xl border border-success/40 bg-card px-3.5 py-2 text-xs italic text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-success" />Hermes travaille… {wait}s
            </div>
          )}
        </div>

        {mode === "claude" && (
          <div className="flex flex-wrap gap-1.5 px-3.5 pb-1">
            <Chip onClick={() => quick("Demande à Hermes de lire ses propres suggestions d'amélioration (fichier agents/memory/suggestions.md) et de me les résumer, puis aide-moi à décider lesquelles valent la peine d'être actionnées.")}>📋 Idées d'Hermes</Chip>
            <Chip onClick={() => quick("Où en est le projet exactement, et quelle est la prochaine étape prioritaire ?")}>📍 Où on en est ?</Chip>
          </div>
        )}

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1} data-testid="msg-input" placeholder={mode === "claude" ? "Demande-moi quelque chose…" : "Parle à Hermes…"}
            className="max-h-28 min-h-9 flex-1 resize-none rounded-2xl border border-input bg-card px-3.5 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="icon" data-testid="send-btn" disabled={sending} onClick={() => send()}
            className={cn("rounded-full", mode === "hermes" && "bg-success hover:bg-success/90")}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-accent">
      {children}
    </button>
  );
}

function MsgBubble({ m, onRelay, onBack }: {
  m: Msg;
  onRelay: (task: string, id: string) => void;
  onBack: (task: string, result: string, id: string) => void;
}) {
  if (m.role === "system") return <div className="self-center px-0 py-0.5 text-center text-[11px] italic text-muted-foreground">{m.content}</div>;

  const isUser = m.role === "user";
  return (
    <div className={cn("flex max-w-[85%] flex-col", isUser ? "self-end items-end" : "self-start items-start")}>
      {!isUser && <div className={cn("mb-0.5 text-[9px] font-extrabold tracking-wider opacity-60", m.role === "hermes" ? "text-success" : "text-primary")}>{m.role.toUpperCase()}</div>}
      <div className={cn(
        "rounded-xl px-3 py-2.5 text-[13px] leading-relaxed",
        isUser ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
        m.role === "hermes" ? "border-success/40" : "border-border"
      )}>
        {m.md ? <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
          : <span className="whitespace-pre-wrap break-words">{m.content}{m.streaming && <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current align-text-bottom" />}</span>}
      </div>

      {m.relayTask && !m.relayedTask && (
        <div className="mt-1.5 w-full rounded-lg border border-success bg-success/15 p-2.5">
          <div className="mb-1 text-[10px] font-extrabold tracking-wider text-success">⚡ TÂCHE À EXÉCUTER SUR LE VPS (via Hermes)</div>
          <div className="mb-2 text-xs text-foreground">{m.relayTask}</div>
          <Button variant="success" size="sm" className="w-full" onClick={() => onRelay(m.relayTask!, m.id)}>📤 Envoyer cette tâche à Hermes</Button>
        </div>
      )}

      {m.backToClaude && (
        <div className="mt-1.5 w-full rounded-lg border border-primary bg-primary/10 p-2.5">
          <div className="mb-1.5 text-[10px] font-extrabold tracking-wider text-primary">↩ BOUCLER VERS CLAUDE</div>
          <Button size="sm" className="w-full" disabled={m.backDone} onClick={() => onBack(m.backToClaude!.task, m.backToClaude!.result, m.id)}>
            {m.backDone ? "Transmis à Claude ✓" : "Analyser ce résultat avec Claude ➤"}
          </Button>
        </div>
      )}
    </div>
  );
}
