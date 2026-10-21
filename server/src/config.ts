import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repository root (…/eptz-agent), independent of the directory the process was started in. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const Env = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is not set (see .env.example)"),
  FIRE_SERVICE_KEY: z.string().optional(),
  CASE_BUDGET_USD: z.coerce.number().positive().max(50).default(3),
  READER_MODEL: z.string().default("claude-haiku-5-5"),
  WRITER_MODEL: z.string().default("claude-sonnet-5-5"),
  WRITER_FALLBACK_MODEL: z.string().default("claude-sonnet-5"),
  PLUGIN_DIR: z.string().default(resolve(ROOT, "vendor/fire-service")),
  RUNS_DIR: z.string().default(resolve(ROOT, "runs")),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  const config = parsed.data;
  if (!existsSync(resolve(config.PLUGIN_DIR, ".claude-plugin/plugin.json"))) {
    throw new Error(`The fire-service plugin is missing in ${config.PLUGIN_DIR} – run: npm run vendor:plugin`);
  }
  return config;
}
