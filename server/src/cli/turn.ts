/**
 * One turn of a case, then exit – for running the agent where a process cannot stay up for the whole
 * case (and the shape the web server will use: a request per turn).
 *
 *   npm run turn -- --case ID --photos DIR [--expert "Име Фамилия"] [--message TEXT | --message-file FILE] [--approve]
 *
 * The first turn reads the photos (--photos, absolute or relative to where npm was run) and starts
 * the session; later turns resume it from runs/<ID>/session.json. Before the first turn the app runs
 * the skill's first command and looks up --expert (when the expert is not the key's owner), so the
 * agent starts with that data instead of fetching it turn by turn. Without --message the first turn
 * asks the agent to start. --approve lets this turn send an e-mail or save a template if the
 * agent asks; otherwise such a request is refused and the agent is told so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { factsOfCase, prefetch } from "../agent/prefetch.js";
import { startCase } from "../agent/session.js";
import { loadConfig, ROOT } from "../config.js";
import { CostLog } from "../costLog.js";
import { readFolder } from "../transcribe/folder.js";
import { print } from "./print.js";

const FIRST = "Изготви ЕПТЗ по материалите в case_ingest.md. Започни с проверката на материалите и числата, писани на ръка.";

function args(argv: string[]) {
  const rest = argv.slice(2);
  const value = (flag: string) => {
    const at = rest.indexOf(flag);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  // npm runs workspace scripts in the workspace folder; paths are relative to where npm was started
  const from = (p: string | undefined) => (p ? resolve(process.env.INIT_CWD ?? process.cwd(), p) : undefined);
  const file = from(value("--message-file"));
  return {
    caseId: value("--case"),
    photos: from(value("--photos")),
    message: file ? readFileSync(file, "utf8").trim() : value("--message"),
    approve: rest.includes("--approve"),
    expert: value("--expert"),
  };
}

async function main() {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const config = loadConfig();
  const { caseId, photos, message, approve, expert } = args(process.argv);
  if (!caseId) throw new Error("--case ID is required");
  const caseDir = join(config.RUNS_DIR, caseId);
  mkdirSync(join(caseDir, "out"), { recursive: true });
  const log = new CostLog(join(config.RUNS_DIR, "costs.jsonl"));
  const sessionFile = join(caseDir, "session.json");
  const saved = existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, "utf8")) as { sessionId: string }) : undefined;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  if (!existsSync(join(caseDir, "case_ingest.md"))) {
    if (!photos) throw new Error("The first turn needs --photos DIR");
    const started = Date.now();
    await readFolder(photos, caseDir, { client, model: config.READER_MODEL, caseId, log }, (done, total) =>
      process.stdout.write(`\rРазчетени ${done} от ${total}`),
    );
    process.stdout.write(` – ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
  }

  const session = startCase(
    config,
    caseId,
    log,
    {
      onMessage(m: SDKMessage) {
        print(m);
        if (m.type === "system" && m.subtype === "init") writeFileSync(sessionFile, JSON.stringify({ sessionId: m.session_id }));
        if (m.type === "result") session.close(); // one turn
      },
      approve: async (action, detail) => {
        process.stdout.write(`\n[${approve ? "одобрено" : "отказано – пусни хода с --approve"}: ${action}]\n  ${detail}\n`);
        return approve;
      },
    },
    saved?.sessionId,
  );
  let text = message ?? FIRST;
  if (!saved) {
    const started = Date.now();
    const facts = await factsOfCase(config, caseDir, client, log, caseId);
    const data = await prefetch(config, caseDir, facts, expert);
    process.stdout.write(`Данни за ${facts.fire_date}, ${facts.place} – ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
    text += `\n\n# Данни, събрани от приложението\n\n${data}`;
  }
  session.send(text);
  await session.done;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
