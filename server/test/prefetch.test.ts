import { describe, expect, it } from "vitest";
import { failureText } from "../src/agent/prefetch.js";

describe("failureText", () => {
  it("says a command was stopped, even when it had already printed something", () => {
    const text = failureText({ killed: true, stdout: "правила", stderr: "", message: "Command failed" });
    expect(text).toContain("спряна след 5 минути");
    expect(text).toContain("правила");
  });

  it("keeps the reason when the output was too long", () => {
    const text = failureText({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, stdout: "правила", message: "stdout maxBuffer length exceeded" });
    expect(text).toContain("maxBuffer");
  });

  it("gives what a failing command printed, or its message when it printed nothing", () => {
    expect(failureText({ code: 1, stderr: "NO_KEY", message: "Command failed" })).toBe("ГРЕШКА: NO_KEY");
    expect(failureText({ code: 1, message: "Command failed" })).toBe("ГРЕШКА: Command failed");
  });
});
