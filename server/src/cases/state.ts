import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * A case's lifecycle:
 *   new → reading → read (the expert checks the date, place and handwritten numbers) → ready
 *   ready → writing → ready … (one agent turn per message)
 * A server restart in the middle of reading or writing leaves "interrupted": read again, or send
 * the message again – the agent's session resumes from its saved transcript.
 */
export const Status = z.enum(["new", "reading", "read", "ready", "writing", "interrupted", "error"]);
export type Status = z.infer<typeof Status>;

export const HandwrittenNumber = z.object({
  file: z.string(),
  value: z.string(),
  context: z.string(),
});

export const Confirmation = z.object({
  fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  place: z.string().trim().min(1).max(100),
  /** each handwritten number as the expert confirmed it; `confirmed` is the right value */
  numbers: z.array(HandwrittenNumber.extend({ confirmed: z.string().trim().min(1).max(200) })).max(200).default([]),
  /** anything else the agent must take as given (corrections, the ЗМ number, wishes) */
  notes: z.string().max(5000).default(""),
});
export type Confirmation = z.infer<typeof Confirmation>;

export const CaseState = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** who the ЕПТЗ is written for, when not the key's owner */
  expert: z.string().optional(),
  status: Status,
  error: z.string().optional(),
  photos: z.array(z.string()).default([]),
  /** read from the materials, for the expert to check */
  facts: z.object({ fire_date: z.string(), place: z.string() }).optional(),
  numbers: z.array(HandwrittenNumber).default([]),
  confirmation: Confirmation.optional(),
  sessionId: z.string().optional(),
  history: z.array(z.object({ role: z.enum(["expert", "agent"]), text: z.string(), at: z.string() })).default([]),
  files: z.array(z.string()).default([]),
  /** what reading the photos and the facts cost (Haiku) */
  readCostUsd: z.number().default(0),
  /** the agent's running total – the SDK keeps counting across resumed turns */
  agentCostUsd: z.number().default(0),
});
export type CaseState = z.infer<typeof CaseState>;

export const caseCost = (s: CaseState) => s.readCostUsd + s.agentCostUsd;

export const CASE_ID = /^[a-z0-9][a-z0-9-]{5,39}$/;

export function stateFile(caseDir: string): string {
  return join(caseDir, "state.json");
}

export async function loadState(caseDir: string): Promise<CaseState | undefined> {
  const file = stateFile(caseDir);
  if (!existsSync(file)) return undefined;
  return CaseState.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Written to a temporary file and renamed, so a crash never leaves half a state file. */
export async function saveState(caseDir: string, state: CaseState): Promise<void> {
  const file = stateFile(caseDir);
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${file}.tmp`, file);
}
