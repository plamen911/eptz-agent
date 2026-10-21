/**
 * What the browser sees of a case while it runs – sent over SSE. Every event gets a number, so a
 * client that reconnects (a phone switching networks) sends Last-Event-ID and gets what it missed.
 */
export type CaseEvent =
  | { type: "status"; status: string; error?: string }
  | { type: "read_progress"; done: number; total: number }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "approval"; id: string; action: string; detail: string }
  | { type: "approval_resolved"; id: string; allowed: boolean }
  | { type: "turn_end"; outcome: string; turnCostUsd: number; caseCostUsd: number; files: string[] }
  | { type: "cost"; caseCostUsd: number };

export interface Numbered {
  id: number;
  event: CaseEvent;
}

type Listener = (e: Numbered) => void;

/** One case's events: numbered, kept in memory for replay (the last `limit`), fanned out to listeners. */
export class EventLog {
  private next = 1;
  private readonly kept: Numbered[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(private readonly limit = 5000) {}

  emit(event: CaseEvent): void {
    const numbered = { id: this.next++, event };
    this.kept.push(numbered);
    if (this.kept.length > this.limit) this.kept.shift();
    for (const listener of this.listeners) listener(numbered);
  }

  /** Events after `afterId` that are still kept, then every new one until the returned function is called. */
  subscribe(afterId: number, listener: Listener): () => void {
    for (const e of this.kept) if (e.id > afterId) listener(e);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get lastId(): number {
    return this.next - 1;
  }
}
