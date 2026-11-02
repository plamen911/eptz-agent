import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const plugin = mkdtempSync(join(tmpdir(), "plugin-"));
mkdirSync(join(plugin, ".claude-plugin"));
writeFileSync(join(plugin, ".claude-plugin/plugin.json"), "{}");
const base = { ANTHROPIC_API_KEY: "k", PLUGIN_DIR: plugin };

describe("loadConfig", () => {
  it("allows SANDBOX=off only on localhost", () => {
    expect(loadConfig({ ...base, SANDBOX: "off" }).SANDBOX).toBe("off");
    expect(() => loadConfig({ ...base, SANDBOX: "off", HOST: "0.0.0.0" })).toThrow(/SANDBOX=off/);
  });
});
