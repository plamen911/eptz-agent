import { describe, expect, it } from "vitest";
import { checkTool, inside } from "../src/agent/guard.js";

const roots = { plugin: "/app/vendor/fire-service", caseDir: "/app/runs/case-1" };

describe("inside", () => {
  it("accepts the root and paths under it, rejects escapes", () => {
    expect(inside("/a/b", "/a/b")).toBe(true);
    expect(inside("/a/b", "/a/b/c/d.md")).toBe(true);
    expect(inside("/a/b", "/a/b/../c")).toBe(false);
    expect(inside("/a/b", "/a/bc")).toBe(false);
  });
});

describe("checkTool", () => {
  it("lets the agent read the plugin and the case, nothing else", () => {
    expect(checkTool("Read", { file_path: "/app/vendor/fire-service/skills/eptz/SKILL.md" }, roots).decision).toBe("allow");
    expect(checkTool("Read", { file_path: "case_ingest.md" }, roots).decision).toBe("allow");
    expect(checkTool("Read", { file_path: "/etc/passwd" }, roots).decision).toBe("deny");
    expect(checkTool("Read", { file_path: "/app/.env" }, roots).decision).toBe("deny");
    expect(checkTool("Grep", { path: "/app/runs/case-2" }, roots).decision).toBe("deny");
  });

  it("writes only in the case folder", () => {
    expect(checkTool("Write", { file_path: "out/report.md" }, roots).decision).toBe("allow");
    expect(checkTool("Write", { file_path: "/app/vendor/fire-service/skills/eptz/SKILL.md" }, roots).decision).toBe("deny");
    expect(checkTool("Edit", { file_path: "../case-2/report.md" }, roots).decision).toBe("deny");
  });

  it("asks before anything leaves the app", () => {
    const mail = checkTool("Bash", { command: "python3 _shared/scripts/poshta.py --do az --tema x a.docx" }, roots);
    expect(mail.decision).toBe("ask");
    const save = checkTool("Bash", { command: "python3 _shared/scripts/obraztsi.py zapis eptz r.md --obekt x" }, roots);
    expect(save.decision).toBe("ask");
    expect(checkTool("Bash", { command: "python3 _shared/scripts/poshta.py --do az a.docx --dry-run" }, roots).decision).toBe("allow");
    expect(checkTool("Bash", { command: "python3 scripts/build_eptz_docx.py --content r.md --meta m.json" }, roots).decision).toBe("allow");
  });

  it("refuses tools the app does not offer", () => {
    expect(checkTool("WebFetch", { url: "https://example.com" }, roots).decision).toBe("deny");
    expect(checkTool("Agent", {}, roots).decision).toBe("deny");
  });
});
