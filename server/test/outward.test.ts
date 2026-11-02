import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EmailInput, emailArgs, TemplateInput, templateArgs } from "../src/agent/outward.js";

const caseDir = mkdtempSync(join(tmpdir(), "case-"));
mkdirSync(join(caseDir, "out"));
writeFileSync(join(caseDir, "out", "Ekspertiza.docx"), "x");
writeFileSync(join(caseDir, "obrazets.md"), "# образец");
const roots = { plugin: "/app/vendor/fire-service", caseDir };
const email = z.object(EmailInput);
const template = z.object(TemplateInput);

describe("send_email", () => {
  it("builds poshta.py's arguments from names in out/, with no shell", () => {
    const args = emailArgs(roots, email.parse({ to: ["az"], subject: "ЕПТЗ", files: ["Ekspertiza.docx"] }));
    expect(args[0]).toBe("/app/vendor/fire-service/shared/scripts/poshta.py");
    expect(args).toEqual(expect.arrayContaining(["--do", "az", "--tema", "ЕПТЗ", join(caseDir, "out", "Ekspertiza.docx")]));
    expect(args).not.toContain("--dry-run");
  });

  it("refuses files outside out/ and files that do not exist", () => {
    expect(() => email.parse({ to: ["az"], subject: "x", files: ["../../.env"] })).toThrow();
    expect(() => emailArgs(roots, email.parse({ to: ["az"], subject: "x", files: ["Nyama.docx"] }))).toThrow(/NO_DATA/);
  });

  it("takes only an address or az as a recipient", () => {
    expect(() => email.parse({ to: ["--do"], subject: "x" })).toThrow();
    expect(email.parse({ to: ["ivan@example.bg"], subject: "x" }).to).toEqual(["ivan@example.bg"]);
  });
});

describe("save_template", () => {
  it("saves an eptz template from the case folder", () => {
    const args = templateArgs(roots, template.parse({ file: "obrazets.md", obekt: "склад", prichina: "късо", belezhka: "б", data: "2026-05-14" }));
    expect(args.slice(0, 4)).toEqual(["/app/vendor/fire-service/shared/scripts/obraztsi.py", "zapis", "eptz", join(caseDir, "obrazets.md")]);
  });

  it("refuses paths and dates that are not plain", () => {
    expect(() => template.parse({ file: "../x.md", obekt: "a", prichina: "b", belezhka: "c", data: "2026-05-14" })).toThrow();
    expect(() => template.parse({ file: "a.md", obekt: "a", prichina: "b", belezhka: "c", data: "14.05.2026" })).toThrow();
  });
});
