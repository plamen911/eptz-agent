import { describe, expect, it } from "vitest";
import { caseOptions } from "../src/agent/session.js";
import type { Config } from "../src/config.js";

const config: Config = {
  ANTHROPIC_API_KEY: "test",
  CASE_BUDGET_USD: 3,
  READER_MODEL: "claude-haiku-5-5",
  WRITER_MODEL: "claude-sonnet-5-5",
  WRITER_FALLBACK_MODEL: "claude-sonnet-5",
  PLUGIN_DIR: "/app/vendor/fire-service",
  RUNS_DIR: "/app/runs",
  SANDBOX: "on",
};
const roots = { plugin: "/app/vendor/fire-service", caseDir: "/app/runs/case-1" };
const hooks = { onMessage: () => {}, approve: async () => false };

describe("caseOptions", () => {
  const options = caseOptions(config, roots, hooks);

  it("loads only the eptz skill from the vendored plugin, no user or project settings", () => {
    expect(options.settingSources).toEqual([]);
    expect(options.plugins).toEqual([{ type: "local", path: roots.plugin }]);
    expect(options.skills).toEqual(["fire-service:eptz"]);
  });

  it("offers no web, subagent or task tools", () => {
    expect(options.tools).toEqual(["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash"]);
  });

  it("runs Bash in the OS sandbox, writing only in the case folder and talking only to the data hosts", () => {
    expect(options.sandbox?.enabled).toBe(true);
    expect(options.sandbox?.failIfUnavailable).toBe(true);
    expect(options.sandbox?.allowUnsandboxedCommands).toBe(false);
    expect(options.sandbox?.filesystem?.allowWrite).toContain(roots.caseDir);
    expect(options.sandbox?.network?.allowedDomains).toEqual(["n8n.fire-expert.uk", "mesonet.agron.iastate.edu"]);
  });

  it("stops at the case budget and works in the case folder", () => {
    expect(options.maxBudgetUsd).toBe(3);
    expect(options.cwd).toBe(roots.caseDir);
    expect(options.fallbackModel).toBe("claude-sonnet-5");
  });

  it("passes the agent only the variables it needs, and no MCP servers from the machine", () => {
    expect(options.env?.FIRE_SERVICE_KEY).toBeUndefined();
    expect(options.env?.ANTHROPIC_API_KEY).toBe("test");
    expect(Object.keys(options.env ?? {}).every((k) => ["ANTHROPIC_API_KEY", "PATH", "HOME", "LANG", "TZ", "TMPDIR"].includes(k))).toBe(true);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({});
  });
});
