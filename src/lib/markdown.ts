// Mini-renderer Markdown sans dépendance (offline-safe), porté de chat.html.
// Sentinelles U+0001 autour du code inline pour ne pas réécrire les chiffres.

const S = String.fromCharCode(1);

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function splitRow(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}
function mdInline(s: string): string {
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return S + (codes.length - 1) + S; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(new RegExp(S + "(\\d+)" + S, "g"), (_m, n) => "<code>" + escHtml(codes[+n]) + "</code>");
  return s;
}
export function renderMarkdown(src: string): string {
  if (!src) return "";
  const blocks: string[] = [];
  let text = src.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push("<pre><code>" + escHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return " CB" + (blocks.length - 1) + " ";
  });
  text = escHtml(text);
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) =>
    /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|---|\*\*\*|___)/.test(l) || /^ CB\d+ $/.test(l.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (/^ CB\d+ $/.test(line.trim())) { out.push(line.trim()); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
      let t = "<table><thead><tr>" + header.map((c) => `<th>${mdInline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) t += "<tr>" + r.map((c) => `<td>${mdInline(c)}</td>`).join("") + "</tr>";
      out.push(t + "</tbody></table>"); continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push("<li>" + mdInline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>"); i++; }
      out.push("<ul>" + items.join("") + "</ul>"); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push("<li>" + mdInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>"); i++; }
      out.push("<ol>" + items.join("") + "</ol>"); continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push("<blockquote>" + mdInline(buf.join(" ")) + "</blockquote>"); continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    out.push("<p>" + mdInline(buf.join("<br>")) + "</p>");
  }
  return out.join("").replace(/ CB(\d+) /g, (_m, n) => blocks[+n]);
}

// Extrait la dernière vraie tâche [HERMES: ...] (ignore les gabarits d'exemple)
// et le texte nettoyé de tous les tags. Porté de chat.html.
export function extractHermesTask(fullText: string): { displayText: string; task: string | null } {
  const displayText = fullText.replace(/`?\[HERMES:[\s\S]+?\]`?/g, "").trim();
  const all = [...fullText.matchAll(/\[HERMES:\s*([\s\S]+?)\]/g)].map((m) => m[1].trim());
  const isPlaceholder = (t: string) => {
    const n = t.toLowerCase().replace(/[\s.…]+$/, "");
    return n.length < 12 || n === "tâche" || n === "tâche précise" ||
      n.startsWith("description précise") || n.startsWith("tâche mécanique") || n.startsWith("tâche à exécuter");
  };
  const real = all.filter((t) => t && !isPlaceholder(t));
  return { displayText, task: real.length ? real[real.length - 1] : null };
}
