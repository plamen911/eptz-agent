import { describe, expect, it } from "vitest";
import { applyProgress, emptyProgress } from "../../server/src/cases/progress.js";
import { bgDate, sortNumbers, stepLabel } from "../src/format";

describe("format", () => {
  it("puts the numbers that go into the conclusion first", () => {
    const { important, other } = sortNumbers([
      { file: "a", value: "3", context: "страница от протокола" },
      { file: "a", value: "23:45", context: "час на локализиране" },
      { file: "a", value: "1,4", context: "височина на контейнера, м" },
      { file: "a", value: "EH 1234 AB", context: "рег. № на автомобила" },
    ]);
    expect(important.map((n) => n.value)).toEqual(["23:45", "1,4", "EH 1234 AB"]);
    expect(other.map((n) => n.value)).toEqual(["3"]);
  });

  it("names the agent's steps in the expert's words", () => {
    expect(stepLabel("Bash", "cd x; python3 $D/scripts/build_eptz_docx.py report.md")).toBe("Сглобява документа");
    expect(stepLabel("Bash", "python3 scripts/pregled.py out/a.docx")).toBe("Проверява документа");
    expect(stepLabel("Skill", "fire-service:eptz")).toBe("Методиката за ЕПТЗ");
    expect(bgDate("2026-05-14")).toBe("14.05.2026");
  });

  it("folds the events of a turn into the work in progress", () => {
    let p = emptyProgress();
    for (const e of [
      { type: "status", status: "writing" },
      { type: "text", delta: "Пиша " },
      { type: "tool", name: "Bash", summary: "ls" },
      { type: "approval", id: "a1", action: "изпращане по и-мейл", detail: "poshta.py" },
      { type: "text", delta: "заключението." },
      { type: "approval_resolved", id: "a1", allowed: false },
    ] as const) {
      p = applyProgress(p, e);
    }
    expect(p).toEqual({ text: "Пиша заключението.", tools: [{ name: "Bash", summary: "ls" }], approvals: [] });
    expect(applyProgress(p, { type: "status", status: "writing" }).text).toBe("");
  });
});
