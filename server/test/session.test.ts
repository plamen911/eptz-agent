import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemPrompt } from "../src/agent/prompt.js";
import { caseOptions, PASSED_ENV } from "../src/agent/session.js";
import type { Config } from "../src/config.js";

/** A minimal plugin with the files the system prompt takes from the eptz skill. */
function fakePlugin(): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-"));
  const skill = join(root, "skills/eptz");
  for (const dir of ["assets", "references", "scripts"]) mkdirSync(join(skill, dir), { recursive: true });
  writeFileSync(join(skill, "assets/report_template.md"), "ШАБЛОН НА ДОКЛАДА");
  writeFileSync(join(skill, "assets/eptz_meta.example.json"), '{"zm_no": "123/2026"}');
  writeFileSync(join(skill, "references/sources.md"), "ИЗТОЧНИЦИ");
  writeFileSync(join(skill, "references/pregled.md"), "ПРЕГЛЕД");
  writeFileSync(join(skill, "scripts/build_smetka.py"), '#!/usr/bin/env python3\n"""\nПОЛЕТА НА СМЕТКАТА\n"""\nimport json\n');
  return root;
}
const plugin = fakePlugin();

const config: Config = {
  ANTHROPIC_API_KEY: "test",
  CASE_BUDGET_USD: 3,
  READER_MODEL: "claude-haiku-5-5",
  WRITER_MODEL: "claude-sonnet-5-5",
  WRITER_FALLBACK_MODEL: "claude-sonnet-5",
  PLUGIN_DIR: plugin,
  RUNS_DIR: "/app/runs",
  SANDBOX: "on",
  PROMPT_CACHE_TTL: "1h",
  ENGINE: "claude",
  HOST: "127.0.0.1",
  PORT: 8787,
};
const roots = { plugin, caseDir: "/app/runs/case-1" };
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
    expect(Object.keys(options.env ?? {}).every((k) => ["ANTHROPIC_API_KEY", ...PASSED_ENV].includes(k))).toBe(true);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({});
  });

  it("puts the skill files read in every case into the cached system prompt, from the vendored plugin", () => {
    const prompt = systemPrompt(roots);
    for (const text of ["ШАБЛОН НА ДОКЛАДА", "ИЗТОЧНИЦИ", "ПРЕГЛЕД", '"zm_no"', "ПОЛЕТА НА СМЕТКАТА"]) expect(prompt).toContain(text);
    expect(prompt).not.toContain("import json"); // the fields of smetka.json, not the script
    expect(options.settings).toEqual({ promptCacheTtl: "1h" });
  });
});
