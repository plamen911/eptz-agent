import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Config } from "../config.js";
import type { CostLog } from "../costLog.js";
import { costUsd } from "../pricing.js";
import { PASSED_ENV } from "./session.js";

const run = promisify(execFile);

/**
 * Everything the skill's first steps fetch – the general rules and terms, the incident record,
 * METAR, the expert's and the director's details – gathered by the app before the agent starts.
 * The agent used to spend 6–8 model calls finding and reading these one by one, each call
 * re-reading the whole conversation; now they arrive in its first message.
 */

const Facts = z.object({
  fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  place: z.string().min(1),
});
export type Facts = z.infer<typeof Facts>;

const FACTS_TOOL = {
  name: "record_facts",
  description: "Record the date and the settlement of the fire from the case materials.",
  input_schema: {
    type: "object" as const,
    properties: {
      fire_date: { type: "string", description: "Date of the fire, YYYY-MM-DD, as stated in the постановление." },
      place: { type: "string", description: "The settlement (град/село) where the fire was, in Bulgarian, e.g. Плевен." },
    },
    required: ["fire_date", "place"],
  },
};

/** Date and place of the fire, read from the materials by the reader model (one small call). */
export async function extractFacts(client: Anthropic, model: string, materials: string, caseId: string, log: CostLog): Promise<Facts> {
  const started = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    tools: [FACTS_TOOL],
    tool_choice: { type: "tool", name: FACTS_TOOL.name },
    messages: [{ role: "user", content: `Материали по делото:\n\n${materials}` }],
  });
  log.add({
    caseId,
    step: "transcribe",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    costUsd: costUsd(model, response.usage),
    ms: Date.now() - started,
    outcome: "ok",
    detail: "facts",
  });
  const call = response.content.find((b) => b.type === "tool_use");
  if (!call || call.type !== "tool_use") throw new Error("The reader did not return the date and place of the fire");
  return Facts.parse(call.input);
}

function scriptEnv(config: Config): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_ENV) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  if (config.FIRE_SERVICE_KEY) env.FIRE_SERVICE_KEY = config.FIRE_SERVICE_KEY;
  return env;
}

/** Runs a shell command in the skill folder; a failure is returned as text, for the agent to see. */
async function inSkill(skillDir: string, command: string, env: Record<string, string>): Promise<string> {
  try {
    const { stdout, stderr } = await run("bash", ["-c", command], { cwd: skillDir, env, timeout: 120_000, maxBuffer: 4 << 20 });
    return (stdout + (stderr ? `\n${stderr}` : "")).trim();
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return `ГРЕШКА: ${(e.stdout ?? "") + (e.stderr ?? "") || e.message}`.trim();
  }
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The date and place of the fire from case_ingest.md in the case folder. */
export async function factsOfCase(config: Config, caseDir: string, client: Anthropic, log: CostLog, caseId: string): Promise<Facts> {
  const materials = await readFile(join(caseDir, "case_ingest.md"), "utf8");
  return extractFacts(client, config.READER_MODEL, materials, caseId, log);
}

/**
 * Runs the skill's first command (its exact form from SKILL.md, with the skill folder given) for the
 * fire's date and place and, when the expert is someone else than the key's owner, looks him and the
 * director up in the staff list. Saves the result as prefetch.md in the case folder and returns it.
 */
export async function prefetch(config: Config, caseDir: string, facts: Facts, expert?: string): Promise<string> {
  const skillDir = join(config.PLUGIN_DIR, "skills/eptz");
  const env = scriptEnv(config);

  const first = await inSkill(
    skillDir,
    `awk '/^## 8\\./{exit}1' _shared/conventions.md; cat _shared/terminology.md; python3 scripts/nachalo.py --data ${facts.fire_date} --mesto ${quote(facts.place)}`,
    env,
  );
  const parts = [
    `## Първата команда на скила (вече пусната от приложението – не я пускай отново)\n\nПапката на скила: ${skillDir}\n\n${first}`,
  ];
  if (expert) {
    const staff = await inSkill(skillDir, `python3 _shared/scripts/sluzhiteli.py ${quote(expert)} --json; python3 _shared/scripts/sluzhiteli.py --direktor`, env);
    parts.push(`## Вещото лице и директорът (от списъка на служителите)\n\nВещото лице е ${expert}, не притежателят на ключа.\n\n${staff}`);
  }
  const text = parts.join("\n\n");
  await writeFile(join(caseDir, "prefetch.md"), text);
  return text;
}
