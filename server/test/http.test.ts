import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaseSession, SessionHooks } from "../src/agent/session.js";
import { CaseManager, type Engine } from "../src/cases/manager.js";
import type { Config } from "../src/config.js";
import { CostLog } from "../src/costLog.js";
import { buildApp } from "../src/http/app.js";

const TOKEN = "t".repeat(32);
const runs = mkdtempSync(join(tmpdir(), "runs-"));
const config = {
  ANTHROPIC_API_KEY: "test",
  CASE_BUDGET_USD: 3,
  READER_MODEL: "claude-haiku-5-5",
  WRITER_MODEL: "claude-sonnet-5-5",
  WRITER_FALLBACK_MODEL: "claude-sonnet-5",
  PLUGIN_DIR: "/nowhere",
  RUNS_DIR: runs,
  SANDBOX: "on",
  PROMPT_CACHE_TTL: "5m",
  ENGINE: "claude",
  HOST: "127.0.0.1",
  PORT: 0,
} satisfies Config;

const log = new CostLog(join(runs, "costs.jsonl"));
const prompts: string[] = [];
const budgets: number[] = [];

/** Stands in for Claude: reads "photos", then runs a turn that streams text, uses a tool, asks once and writes a document. */
const engine: Engine = {
  async readPhotos(_photos, _caseDir, caseId, onPage) {
    onPage(1, 2);
    log.add({ caseId, step: "transcribe", model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, ms: 1, outcome: "ok" });
    onPage(2, 2);
    return [{ file: "001-p.jpg", value: "1,4", context: "височина на контейнера, м" }];
  },
  facts: async () => ({ fire_date: "2026-05-14", place: "Плевен" }),
  prefetch: async () => "ДАННИ ОТ СКИЛА",
  startCase(caseId: string, budgetUsd: number, hooks: SessionHooks, resume?: string): CaseSession {
    budgets.push(budgetUsd);
    let close!: () => void;
    const done = new Promise<void>((resolve) => (close = resolve));
    const emit = (m: unknown) => hooks.onMessage(m as SDKMessage);
    return {
      send(text) {
        prompts.push(text);
        void (async () => {
          emit({ type: "system", subtype: "init", session_id: resume ?? "session-1" });
          emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Пиша " } } });
          emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "python3 scripts/pregled.py out/x.docx\nsecond line" } }] } });
          const allowed = await hooks.approve("Изпращане по пощата", "poshta.py --to ...");
          writeFileSync(join(runs, caseId, "out", "Ekspertiza.docx"), "DOCX");
          emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: allowed ? "изпратено." : "не е изпратено." } } });
          emit({ type: "result", subtype: "success", total_cost_usd: resume ? 0.75 : 0.5, num_turns: 3, modelUsage: {} });
        })();
      },
      close: () => close(),
      done,
    };
  },
};

let app: FastifyInstance;
let base: string;
const auth = { authorization: `Bearer ${TOKEN}` };

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}
const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** The number of the case's last event – open the stream after it to see only what comes next. */
const mark = async (id: string): Promise<number> => (await api(`/api/cases/${id}`)).body.lastEventId;

/** Reads the SSE stream until `until` is true for an event; returns every event seen. */
async function events(id: string, until: (e: { seq?: number; type: string; [k: string]: unknown }) => boolean, lastEventId?: number) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/cases/${id}/events?token=${TOKEN}`, {
    signal: controller.signal,
    headers: lastEventId ? { "last-event-id": String(lastEventId) } : {},
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const seen: { seq?: number; type: string; [k: string]: unknown }[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const idLine = chunk.split("\n").find((l) => l.startsWith("id: "));
      const name = chunk.split("\n").find((l) => l.startsWith("event: "))?.slice(7) ?? "";
      const event = { ...JSON.parse(data.slice(6)), type: name, ...(idLine ? { seq: Number(idLine.slice(4)) } : {}) };
      seen.push(event);
      if (until(event)) {
        controller.abort();
        return seen;
      }
    }
  }
  return seen;
}

beforeAll(async () => {
  app = await buildApp({ manager: new CaseManager(config, engine, log), token: TOKEN, plugin: { version: "2.30.5", ref: "abc" }, heartbeatMs: 50 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => app.close());

describe("the case API", () => {
  let id = "";

  it("answers the health check without a token and refuses the API without one", async () => {
    expect((await (await fetch(`${base}/api/health`)).json()).plugin.version).toBe("2.30.5");
    expect((await fetch(`${base}/api/cases`)).status).toBe(401);
    expect((await fetch(`${base}/api/cases`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("creates a case and takes the photos in upload order, images only", async () => {
    const created = await post("/api/cases", { expert: "Божидар Василев" });
    expect(created.status).toBe(201);
    id = created.body.id;
    expect(created.body).toMatchObject({ status: "new", expert: "Божидар Василев", costUsd: 0 });

    const form = new FormData();
    form.append("photo", new Blob(["jpeg"]), "постановление стр 1.JPEG");
    form.append("photo", new Blob(["png"]), "протокол.png");
    const uploaded = await api(`/api/cases/${id}/photos`, { method: "POST", body: form });
    expect(uploaded.body.photos).toEqual(["001-постановление_стр_1.jpg", "002-протокол.png"]);

    const bad = new FormData();
    bad.append("photo", new Blob(["x"]), "notes.txt");
    expect((await api(`/api/cases/${id}/photos`, { method: "POST", body: bad })).status).toBe(415);
  });

  it("will not start the agent before the expert has checked the reading", async () => {
    expect((await post(`/api/cases/${id}/messages`)).status).toBe(409);
  });

  it("reads the photos in the background and streams the progress", async () => {
    const from = await mark(id);
    expect((await post(`/api/cases/${id}/read`)).status).toBe(202);
    const seen = await events(id, (e) => e.type === "status" && e.status === "read", from);
    expect(seen.filter((e) => e.type === "read_progress").map((e) => e.done)).toEqual([1, 2]);
    expect(seen.some((e) => e.type === "cost" && e.caseCostUsd === 0.01)).toBe(true);
    const state = (await api(`/api/cases/${id}`)).body;
    expect(state).toMatchObject({ status: "read", facts: { fire_date: "2026-05-14", place: "Плевен" } });
    expect(state.numbers[0].value).toBe("1,4");
  });

  it("checks the confirmation and puts it into the agent's first message", async () => {
    expect((await post(`/api/cases/${id}/confirm`, { fire_date: "14.05.2026", place: "Плевен" })).status).toBe(400);
    const confirmed = await post(`/api/cases/${id}/confirm`, {
      fire_date: "2026-05-14",
      place: "Плевен",
      numbers: [{ file: "001-p.jpg", value: "1,4", context: "височина на контейнера, м", confirmed: "1,40" }],
      notes: "Номерът на ЗМ е 251/2026.",
    });
    expect(confirmed.body.status).toBe("ready");
  });

  it("streams a turn – text, tool steps, an approval the expert answers – and offers the document", async () => {
    const from = await mark(id);
    expect((await post(`/api/cases/${id}/messages`)).status).toBe(202);
    const seen = await events(
      id,
      (e) => {
        if (e.type === "approval") void post(`/api/cases/${id}/approvals/${e.id}`, { allow: true });
        return e.type === "status" && e.status === "ready";
      },
      from,
    );
    const prompt = prompts.at(-1) ?? "";
    expect(prompt).toContain("Вещото лице е Божидар Василев");
    expect(prompt).toContain("височина на контейнера, м: 1,40 (разчетено като „1,4“ – грешно)");
    expect(prompt).toContain("Номерът на ЗМ е 251/2026.");
    expect(prompt).toContain("ДАННИ ОТ СКИЛА");
    expect(budgets.at(-1)).toBeCloseTo(2.99); // the case budget minus the reading

    expect(seen.find((e) => e.type === "tool")).toMatchObject({ name: "Bash", summary: "python3 scripts/pregled.py out/x.docx" });
    expect(seen.find((e) => e.type === "approval_resolved")).toMatchObject({ allowed: true });
    expect(seen.find((e) => e.type === "turn_end")).toMatchObject({ outcome: "success", turnCostUsd: 0.5, caseCostUsd: 0.51, files: ["Ekspertiza.docx"] });

    const state = (await api(`/api/cases/${id}`)).body;
    expect(state).toMatchObject({ status: "ready", sessionId: "session-1", costUsd: 0.51 });
    expect(state.history.at(-1)).toMatchObject({ role: "agent", text: "Пиша изпратено." });

    const file = await fetch(`${base}/api/cases/${id}/files/Ekspertiza.docx`, { headers: auth });
    expect(await file.text()).toBe("DOCX");
    expect(file.headers.get("content-disposition")).toContain("Ekspertiza.docx");
    expect((await fetch(`${base}/api/cases/${id}/files/..%2Fstate.json`, { headers: auth })).status).toBe(404);
  });

  it("replays only what a reconnecting client missed", async () => {
    const all = await events(id, (e) => e.type === "turn_end");
    const lastId = all.find((e) => e.type === "turn_end")?.seq ?? 0;
    const missed = await events(id, (e) => e.type === "status", lastId);
    expect(missed.filter((e) => e.type !== "snapshot").every((e) => (e.seq ?? 0) > lastId)).toBe(true);
  });

  it("resumes the session on the next message and counts only the new cost", async () => {
    expect((await post(`/api/cases/${id}/messages`)).status).toBe(400); // a follow-up needs words
    const from = await mark(id);
    expect((await post(`/api/cases/${id}/messages`, { text: "Съкрати въпрос 6." })).status).toBe(202);
    const seen = await events(
      id,
      (e) => {
        if (e.type === "approval") void post(`/api/cases/${id}/approvals/${e.id}`, { allow: false });
        return e.type === "status" && e.status === "ready";
      },
      from,
    );
    expect(prompts.at(-1)).toBe("Съкрати въпрос 6.");
    expect(seen.find((e) => e.type === "turn_end")).toMatchObject({ turnCostUsd: 0.25, caseCostUsd: 0.76 });
    expect(seen.find((e) => e.type === "approval_resolved")).toMatchObject({ allowed: false });
  });

  it("refuses unknown or malformed case ids", async () => {
    expect((await api("/api/cases/../../etc")).status).toBe(404);
    expect((await api("/api/cases/2026-01-01-ffffffff")).status).toBe(404);
  });
});
