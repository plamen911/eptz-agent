import type { CaseEvent } from "./events.js";

/**
 * The work in progress, folded from the events: the server keeps it so a page opened in the middle of
 * a turn starts from what is already written; the web app folds the same events the same way.
 * No imports beyond the event type – the web app uses this file as it is.
 */
export interface Progress {
  read?: { done: number; total: number };
  text: string;
  tools: { name: string; summary: string }[];
  approvals: { id: string; action: string; detail: string }[];
}

export const emptyProgress = (): Progress => ({ text: "", tools: [], approvals: [] });

export function applyProgress(p: Progress, e: CaseEvent): Progress {
  switch (e.type) {
    case "status":
      // new work starts from nothing; finished work keeps its text until the page reloads the case
      return e.status === "reading" || e.status === "writing" ? emptyProgress() : { ...p, approvals: [] };
    case "read_progress":
      return { ...p, read: { done: e.done, total: e.total } };
    case "text":
      return { ...p, text: p.text + e.delta };
    case "tool":
      return { ...p, tools: [...p.tools, { name: e.name, summary: e.summary }] };
    case "approval":
      return { ...p, approvals: [...p.approvals, { id: e.id, action: e.action, detail: e.detail }] };
    case "approval_resolved":
      return { ...p, approvals: p.approvals.filter((a) => a.id !== e.id) };
    default:
      return p;
  }
}
