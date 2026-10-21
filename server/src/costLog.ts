import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One model call (or one agent run) – what it cost, how long it took and how it ended. */
export interface CostEntry {
  at: string;
  caseId: string;
  step: "transcribe" | "agent";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  ms: number;
  outcome: "ok" | "error" | "budget" | "retry";
  detail?: string;
}

/** Appends to a JSONL file – one line per entry; the metrics page and the case study read it. */
export class CostLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  add(entry: Omit<CostEntry, "at">): void {
    appendFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  }
}
