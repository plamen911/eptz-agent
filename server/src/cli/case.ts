/**
 * The agent in the terminal – step 0/1 of the plan, before the web app.
 *
 *   npm run case -- <folder with photos> [--case ID] [--reuse] [--inbox FILE]
 *
 * Reads every photo with the reader model, writes runs/<ID>/case_ingest.md, then opens a
 * conversation with the writer agent. Type your answers; an empty line or "край" ends it.
 * --reuse skips the reading when runs/<ID>/case_ingest.md already exists.
 * --inbox reads the answers from lines appended to FILE instead of the terminal, so the agent can
 *   run in the background (output to a log file) until the web app exists.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { startCase } from "../agent/session.js";
import { loadConfig, ROOT } from "../config.js";
import { CostLog } from "../costLog.js";
import { readFolder } from "../transcribe/folder.js";
import { fileInput, terminalInput } from "./input.js";
import { print } from "./print.js";

function args(argv: string[]) {
  const rest = argv.slice(2);
  const value = (flag: string) => {
    const at = rest.indexOf(flag);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const caseId = value("--case");
  const inbox = value("--inbox");
  const folder = rest.find((a, i) => !a.startsWith("--") && !["--case", "--inbox"].includes(rest[i - 1] ?? ""));
  // npm runs workspace scripts in the workspace folder; paths are relative to where npm was started
  const base = process.env.INIT_CWD ?? process.cwd();
  return {
    folder: folder ? resolve(base, folder) : undefined,
    caseId,
    inbox: inbox ? resolve(base, inbox) : undefined,
    reuse: rest.includes("--reuse"),
  };
}

async function main() {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const config = loadConfig();
  const { folder, caseId: given, reuse, inbox } = args(process.argv);
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

  const input = inbox ? fileInput(inbox) : terminalInput();
  // one reader of the input: a line answers a pending approval, or goes to the agent
  let pendingApproval: ((answer: string) => void) | undefined;
  const session = startCase(config, caseId, log, {
    onMessage: print,
    approve: (action, detail) => {
      process.stdout.write(`\n\nОдобрявате ли: ${action}?\n  ${detail}\n[да/не] `);
      return new Promise<boolean>((resolve) => {
        pendingApproval = (answer) => resolve(/^(да|y)/i.test(answer));
      });
    },
  });

  session.send(
    "Изготви ЕПТЗ по материалите в case_ingest.md. Започни с проверката на материалите и числата, писани на ръка.",
  );
  void session.done.then(() => input.close());
  for (;;) {
    const line = (await input.next())?.trim();
    if (line === undefined) break;
    if (pendingApproval) {
      const answer = pendingApproval;
      pendingApproval = undefined;
      answer(line);
      continue;
    }
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
