import type { CaseEvent } from "../../server/src/cases/events.js";
import type { Progress } from "../../server/src/cases/progress.js";

export type { CaseEvent, Progress };

export type Status = "new" | "reading" | "read" | "ready" | "writing" | "interrupted" | "error";

export interface HandwrittenNumber {
  file: string;
  value: string;
  context: string;
}

export interface Confirmation {
  fire_date: string;
  place: string;
  numbers: (HandwrittenNumber & { confirmed: string })[];
  notes: string;
}

/** A case as the server sends it (GET /api/cases/:id). */
export interface CaseView {
  id: string;
  createdAt: string;
  expert?: string;
  status: Status;
  error?: string;
  photos: string[];
  facts?: { fire_date: string; place: string };
  numbers: HandwrittenNumber[];
  confirmation?: Confirmation;
  sessionId?: string;
  history: { role: "expert" | "agent"; text: string; at: string }[];
  files: string[];
  costUsd: number;
  lastEventId: number;
  progress: Progress | null;
}
