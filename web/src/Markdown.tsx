import type { ReactNode } from "react";

/** **bold** and `code` inside a line – React elements, never HTML from the model. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith("**") ? <strong key={m.index}>{token.slice(2, -2)}</strong> : <code key={m.index}>{token.slice(1, -1)}</code>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The small part of Markdown the agent writes in the chat: paragraphs, headings, bulleted and
 * numbered lists, bold and code. Enough for its summaries; the report itself is in the .docx.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={i}>{inline(heading[1] ?? "")}</h3>);
      i++;
      continue;
    }
    const listRe = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && listRe.test(lines[i] ?? "")) {
        items.push(<li key={i}>{inline(listRe.exec(lines[i] ?? "")?.[1] ?? "")}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !listRe.test(lines[i] ?? "") && !/^#{1,4}\s/.test(lines[i] ?? "")) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push(<p key={`p${i}`}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}
