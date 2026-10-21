/**
 * The agent in the terminal – step 0/1 of the plan, before the web app.
 *
 *   npm run case -- <folder with photos> [--case ID] [--reuse]
 *
 * Reads every photo with the reader model, writes runs/<ID>/case_ingest.md, then opens a
 * conversation with the writer agent. Type your answers; an empty line or "край" ends it.
 * --reuse skips the reading when runs/<ID>/case_ingest.md already exists.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { startCase } from "../agent/session.js";
import { loadConfig, ROOT } from "../config.js";
import { CostLog } from "../costLog.js";
import { readFolder } from "../transcribe/folder.js";

function args(argv: string[]) {
  const rest = argv.slice(2);
  const folder = rest.find((a) => !a.startsWith("--"));
  const caseFlag = rest.indexOf("--case");
  return {
    folder: folder ? resolve(folder) : undefined,
    caseId: caseFlag >= 0 ? rest[caseFlag + 1] : undefined,
    reuse: rest.includes("--reuse"),
  };
}

function print(message: SDKMessage): void {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") process.stdout.write(event.delta.text);
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      process.stdout.write(`\n  · ${event.content_block.name}\n`);
    }
  } else if (message.type === "result") {
    const cost = message.total_cost_usd.toFixed(3);
    process.stdout.write(`\n\n[${message.subtype}] ${cost} USD до момента, ${message.num_turns} хода\n> `);
  } else if (message.type === "system" && message.subtype === "init") {
    process.stdout.write(`[скилове: ${message.skills.filter((s) => s.startsWith("fire-service")).join(", ")}]\n`);
  }
}

async function main() {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const config = loadConfig();
  const { folder, caseId: given, reuse } = args(process.argv);
  const caseId = given ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const caseDir = join(config.RUNS_DIR, caseId);
  mkdirSync(join(caseDir, "out"), { recursive: true });
  const log = new CostLog(join(config.RUNS_DIR, "costs.jsonl"));

  if (!(reuse && existsSync(join(caseDir, "case_ingest.md")))) {
    if (!folder) throw new Error("Give the folder with the photos: npm run case -- <folder>");
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
    const started = Date.now();
    await readFolder(folder, caseDir, { client, model: config.READER_MODEL, caseId, log }, (done, total) =>
      process.stdout.write(`\rРазчетени ${done} от ${total}`),
    );
    process.stdout.write(` – ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const session = startCase(config, caseId, log, {
    onMessage: print,
    approve: async (action, detail) =>
      /^(да|y)/i.test(await rl.question(`\n\nОдобрявате ли: ${action}?\n  ${detail}\n[да/не] `)),
  });

  session.send(
    "Изготви ЕПТЗ по материалите в case_ingest.md. Започни с проверката на материалите и числата, писани на ръка.",
  );
  void session.done.then(() => rl.close());
  for (;;) {
    const line = (await rl.question("")).trim();
    if (line === "" || line === "край") break;
    session.send(line);
  }
  session.close();
  await session.done;
  console.log(`\nФайловете са в ${join(caseDir, "out")}; разходите – в ${join(config.RUNS_DIR, "costs.jsonl")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
