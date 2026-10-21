/**
 * The web server: npm run serve. Settings come from .env (see .env.example).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeEngine } from "../cases/engine.js";
import { CaseManager } from "../cases/manager.js";
import { loadConfig, ROOT } from "../config.js";
import { CostLog } from "../costLog.js";
import { buildApp } from "./app.js";

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadConfig();

if (!config.APP_TOKEN && !["127.0.0.1", "localhost", "::1"].includes(config.HOST)) {
  throw new Error("Set APP_TOKEN before listening on anything but localhost – every case spends API money");
}

const lock = Object.fromEntries(
  readFileSync(join(ROOT, "plugin.lock"), "utf8")
    .split("\n")
    .map((line) => line.split("="))
    .filter((kv) => kv.length === 2)
    .map(([k, v]) => [k?.trim(), v?.trim()]),
) as Record<string, string>;

const log = new CostLog(join(config.RUNS_DIR, "costs.jsonl"));
const manager = new CaseManager(config, claudeEngine(config, log), log);
const app = await buildApp({
  manager,
  ...(config.APP_TOKEN ? { token: config.APP_TOKEN } : {}),
  plugin: { version: lock.version ?? "?", ref: lock.ref ?? "?" },
  logger: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ host: config.HOST, port: config.PORT });
