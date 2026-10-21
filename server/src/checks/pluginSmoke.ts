/**
 * Starts the agent far enough to see what it loaded – no API call – and checks that the vendored
 * fire-service plugin is the one in plugin.lock and that its eptz skill is there. Run in CI after
 * every plugin update, so a change in the plugin's layout fails the build, not a case.
 *
 *   npm run check:plugin
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { caseOptions } from "../agent/session.js";
import { ROOT, type Config } from "../config.js";

const lock = Object.fromEntries(
  readFileSync(join(ROOT, "plugin.lock"), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => line.split("=", 2) as [string, string]),
);

const config: Config = {
  ANTHROPIC_API_KEY: "sk-ant-smoke-test", // never used: the check stops before the first API call
  CASE_BUDGET_USD: 0.01,
  READER_MODEL: "claude-haiku-5-5",
  WRITER_MODEL: "claude-sonnet-5-5",
  WRITER_FALLBACK_MODEL: "claude-sonnet-5",
  PLUGIN_DIR: join(ROOT, "vendor/fire-service"),
  RUNS_DIR: join(ROOT, "runs"),
};
const roots = { plugin: config.PLUGIN_DIR, caseDir: join(config.RUNS_DIR, "smoke") };
const options = caseOptions(config, roots, { onMessage() {}, approve: async () => false });
const abort = new AbortController();
options.abortController = abort;
options.env = { ...options.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };

let failures: string[] = ["no init message"];
try {
  for await (const message of query({ prompt: "smoke", options })) {
    if (message.type !== "system" || message.subtype !== "init") continue;
    failures = [];
    const plugin = message.plugins.find((p) => p.name === "fire-service");
    if (!plugin) failures.push("the fire-service plugin did not load");
    else if ("version" in plugin && plugin.version !== lock.version) {
      failures.push(`plugin version ${String(plugin.version)}, plugin.lock says ${lock.version}`);
    }
    if (!message.skills.includes("fire-service:eptz")) failures.push("the fire-service:eptz skill is missing");
    if (!message.tools.includes("Skill") || message.tools.includes("WebFetch")) failures.push(`unexpected tools: ${message.tools.join(", ")}`);
    abort.abort();
  }
} catch (error) {
  if (!abort.signal.aborted) failures.push(String(error));
}

if (failures.length) {
  console.error("plugin check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`fire-service ${lock.version} (${lock.ref?.slice(0, 7)}): loaded, eptz skill present`);
