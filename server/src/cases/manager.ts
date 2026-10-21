import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CaseSession, SessionHooks } from "../agent/session.js";
import type { Facts } from "../agent/prefetch.js";
import type { Config } from "../config.js";
import type { CostLog } from "../costLog.js";
import { EventLog } from "./events.js";
import { firstMessage } from "./firstMessage.js";
import { CASE_ID, type CaseState, caseCost, type Confirmation, loadState, saveState } from "./state.js";

/** The model-facing work, behind one interface – the real one calls Claude, the tests pass a fake. */
export interface Engine {
  readPhotos(photosDir: string, caseDir: string, caseId: string, onPage: (done: number, total: number) => void): Promise<CaseState["numbers"]>;
  facts(caseDir: string, caseId: string): Promise<Facts>;
  prefetch(caseDir: string, facts: Facts, expert?: string): Promise<string>;
  startCase(caseId: string, budgetUsd: number, hooks: SessionHooks, resume?: string): CaseSession;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Live {
  state: CaseState;
  events: EventLog;
  busy: boolean;
  approvals: Map<string, (allowed: boolean) => void>;
  saving: Promise<void>;
}

const IMAGE = /^\.(jpe?g|png|webp)$/i;
/** An approval nobody answers is refused after this long – the agent goes on without it. */
const APPROVAL_TIMEOUT_MS = 15 * 60_000;

/** Short text for a tool step – what the expert sees in the activity list. */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  if (name === "Bash") return text(input.command).split("\n")[0]?.slice(0, 160) ?? "";
  if (name === "Skill") return text(input.skill);
  if (["Read", "Write", "Edit"].includes(name)) return basename(text(input.file_path));
  if (name === "Glob" || name === "Grep") return text(input.pattern);
  return "";
}

/**
 * Every case the server knows: its state on disk (state.json in the case folder), its events in
 * memory for SSE, and at most one running piece of work – reading the photos or one agent turn.
 */
export class CaseManager {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly config: Config,
    private readonly engine: Engine,
    log: CostLog,
  ) {
    // the reader's calls are logged one by one; add them to the case as they come
    log.onAdd((entry) => {
      if (entry.step !== "transcribe" || !entry.costUsd) return;
      const live = this.live.get(entry.caseId);
      if (!live) return;
      live.state.readCostUsd += entry.costUsd;
      live.events.emit({ type: "cost", caseCostUsd: caseCost(live.state) });
      this.save(live);
    });
  }

  caseDir(id: string): string {
    return join(this.config.RUNS_DIR, id);
  }

  /** Outside the case folder, so the agent – which works in that folder – never opens the photos. */
  photosDir(id: string): string {
    return join(this.config.RUNS_DIR, "_photos", id);
  }

  private save(live: Live): Promise<void> {
    // one write at a time per case – two at once would race on the temporary file
    live.saving = live.saving.then(() => saveState(this.caseDir(live.state.id), live.state)).catch(() => {});
    return live.saving;
  }

  private setStatus(live: Live, status: CaseState["status"], error?: string): void {
    live.state.status = status;
    if (error) live.state.error = error;
    else delete live.state.error;
    live.events.emit(error ? { type: "status", status, error } : { type: "status", status });
    void this.save(live);
  }

  async create(expert?: string): Promise<CaseState> {
    const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`;
    await mkdir(join(this.caseDir(id), "out"), { recursive: true });
    await mkdir(this.photosDir(id), { recursive: true });
    const state: CaseState = {
      id,
      createdAt: new Date().toISOString(),
      ...(expert?.trim() ? { expert: expert.trim() } : {}),
      status: "new",
      photos: [],
      numbers: [],
      history: [],
      files: [],
      readCostUsd: 0,
      agentCostUsd: 0,
    };
    const live: Live = { state, events: new EventLog(), busy: false, approvals: new Map(), saving: Promise.resolve() };
    this.live.set(id, live);
    await this.save(live);
    return state;
  }

  async get(id: string): Promise<Live> {
    if (!CASE_ID.test(id)) throw new HttpError(404, "No such case");
    const known = this.live.get(id);
    if (known) return known;
    const state = await loadState(this.caseDir(id));
    if (!state) throw new HttpError(404, "No such case");
    // work that was running when the server stopped is not running now
    if (state.status === "reading" || state.status === "writing") state.status = "interrupted";
    const live: Live = { state, events: new EventLog(), busy: false, approvals: new Map(), saving: Promise.resolve() };
    this.live.set(id, live);
    return live;
  }

  async list(): Promise<CaseState[]> {
    if (!existsSync(this.config.RUNS_DIR)) return [];
    const ids = (await readdir(this.config.RUNS_DIR)).filter((d) => CASE_ID.test(d));
    const states = await Promise.all(ids.map((id) => this.get(id).then((l) => l.state, () => undefined)));
    return states.filter((s): s is CaseState => s !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Saves one uploaded photo; the upload order is kept in the name, since pages are read in name order. */
  async addPhoto(id: string, filename: string, data: NodeJS.ReadableStream): Promise<string> {
    const live = await this.get(id);
    if (!["new", "interrupted", "error"].includes(live.state.status) || live.busy) {
      throw new HttpError(409, "Photos can be added only before the case is read");
    }
    const ext = extname(filename).toLowerCase();
    if (!IMAGE.test(ext)) throw new HttpError(415, "Only JPEG, PNG or WebP photos");
    const stem = basename(filename, extname(filename)).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "photo";
    const name = `${String(live.state.photos.length + 1).padStart(3, "0")}-${stem}${ext === ".jpeg" ? ".jpg" : ext}`;
    await pipeline(data, createWriteStream(join(this.photosDir(id), name)));
    live.state.photos.push(name);
    await this.save(live);
    return name;
  }

  /** Reads the photos in the background; progress and the result arrive as events. */
  async read(id: string): Promise<void> {
    const live = await this.get(id);
    if (live.busy || !["new", "interrupted", "error"].includes(live.state.status) || live.state.sessionId) {
      throw new HttpError(409, `The case is ${live.state.status}`);
    }
    if (live.state.photos.length === 0) throw new HttpError(400, "Upload the photos first");
    live.busy = true;
    this.setStatus(live, "reading");
    void (async () => {
      try {
        const caseDir = this.caseDir(id);
        live.state.numbers = await this.engine.readPhotos(this.photosDir(id), caseDir, id, (done, total) =>
          live.events.emit({ type: "read_progress", done, total }),
        );
        live.state.facts = await this.engine.facts(caseDir, id);
        this.setStatus(live, "read");
      } catch (error) {
        this.setStatus(live, "error", (error as Error).message);
      } finally {
        live.busy = false;
      }
    })();
  }

  /** The expert checked the date, place and handwritten numbers – the agent may start. */
  async confirm(id: string, confirmation: Confirmation): Promise<CaseState> {
    const live = await this.get(id);
    if (live.busy || live.state.sessionId || !["read", "ready"].includes(live.state.status)) {
      throw new HttpError(409, `The case is ${live.state.status}`);
    }
    live.state.confirmation = confirmation;
    this.setStatus(live, "ready");
    await live.saving;
    return live.state;
  }

  /** One agent turn in the background: the first one starts the case, later ones resume it. */
  async send(id: string, text?: string): Promise<void> {
    const live = await this.get(id);
    const { state } = live;
    const canStart = state.status === "ready" || ((state.status === "interrupted" || state.status === "error") && state.confirmation);
    if (live.busy || !canStart) throw new HttpError(409, `The case is ${state.status}`);
    if (state.sessionId && !text?.trim()) throw new HttpError(400, "Write a message");
    // the SDK counts the agent's cost across resumed turns, so its budget is the case budget minus the reading
    const budget = this.config.CASE_BUDGET_USD - state.readCostUsd;
    if (caseCost(state) >= this.config.CASE_BUDGET_USD) throw new HttpError(402, "The case budget is spent");

    live.busy = true;
    state.history.push({ role: "expert", text: text?.trim() || "Изготви ЕПТЗ и сметката.", at: new Date().toISOString() });
    this.setStatus(live, "writing");

    void (async () => {
      let reply = "";
      let outcome = "error";
      const costBefore = state.agentCostUsd;
      try {
        let prompt = text?.trim() ?? "";
        if (!state.sessionId) {
          const confirmed = state.confirmation as Confirmation;
          const facts = { fire_date: confirmed.fire_date, place: confirmed.place };
          prompt = firstMessage(state, confirmed, await this.engine.prefetch(this.caseDir(id), facts, state.expert), text);
        }
        const session: CaseSession = this.engine.startCase(id, budget, {
          onMessage: (m) => {
            reply += this.onAgentMessage(live, m, reply);
            if (m.type === "result") {
              outcome = m.subtype;
              state.agentCostUsd = m.total_cost_usd;
              session.close();
            }
          },
          approve: (action, detail) => this.askApproval(live, action, detail),
        }, state.sessionId);
        session.send(prompt);
        await session.done;
        state.files = await this.outFiles(id);
        state.history.push({ role: "agent", text: reply.trim(), at: new Date().toISOString() });
        live.events.emit({
          type: "turn_end",
          outcome,
          turnCostUsd: state.agentCostUsd - costBefore,
          caseCostUsd: caseCost(state),
          files: state.files,
        });
        this.setStatus(live, outcome === "success" ? "ready" : "error", outcome === "success" ? undefined : `The turn ended: ${outcome}`);
      } catch (error) {
        if (reply.trim()) state.history.push({ role: "agent", text: reply.trim(), at: new Date().toISOString() });
        this.setStatus(live, "error", (error as Error).message);
      } finally {
        live.busy = false;
        for (const resolve of live.approvals.values()) resolve(false);
        live.approvals.clear();
      }
    })();
  }

  /** Turns one SDK message into events; returns the text to add to the agent's reply. */
  private onAgentMessage(live: Live, m: SDKMessage, replySoFar: string): string {
    const { state, events } = live;
    if (m.type === "system" && m.subtype === "init") {
      state.sessionId = m.session_id;
      void this.save(live);
    } else if (m.type === "stream_event") {
      const e = m.event;
      if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
        events.emit({ type: "text", delta: e.delta.text });
        return e.delta.text;
      }
      if (e.type === "content_block_start" && e.content_block.type === "text" && replySoFar && !replySoFar.endsWith("\n\n")) {
        events.emit({ type: "text", delta: "\n\n" }); // text blocks between tool calls are separate paragraphs
        return "\n\n";
      }
    } else if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type === "tool_use") {
          events.emit({ type: "tool", name: block.name, summary: toolSummary(block.name, block.input as Record<string, unknown>) });
        }
      }
    }
    return "";
  }

  private askApproval(live: Live, action: string, detail: string): Promise<boolean> {
    const id = randomBytes(6).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
      const finish = (allowed: boolean) => {
        clearTimeout(timer);
        if (!live.approvals.delete(id)) return;
        live.events.emit({ type: "approval_resolved", id, allowed });
        resolve(allowed);
      };
      live.approvals.set(id, finish);
      live.events.emit({ type: "approval", id, action, detail });
    });
  }

  async resolveApproval(id: string, approvalId: string, allowed: boolean): Promise<void> {
    const live = await this.get(id);
    const finish = live.approvals.get(approvalId);
    if (!finish) throw new HttpError(404, "No such approval – it was answered or has expired");
    finish(allowed);
  }

  private async outFiles(id: string): Promise<string[]> {
    const dir = join(this.caseDir(id), "out");
    if (!existsSync(dir)) return [];
    return (await readdir(dir)).filter((f) => /\.(docx|xlsx|pdf)$/i.test(f)).sort();
  }

  /** The path of a finished document – only names the out/ folder actually holds. */
  async file(id: string, name: string): Promise<string> {
    await this.get(id);
    const files = await this.outFiles(id);
    if (!files.includes(name)) throw new HttpError(404, "No such file");
    return join(this.caseDir(id), "out", name);
  }
}
