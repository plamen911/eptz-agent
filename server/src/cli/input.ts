import { closeSync, existsSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

/** Where the expert's answers come from: the terminal, or a file another process appends lines to. */
export interface Input {
  /** The next answer, or undefined when the input has ended. */
  next(prompt?: string): Promise<string | undefined>;
  close(): void;
}

export function terminalInput(): Input {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => (closed = true));
  return {
    next: async (prompt = "") => (closed ? undefined : rl.question(prompt).catch(() => undefined)),
    close: () => rl.close(),
  };
}

/**
 * Lines appended to `file`, one answer per line – for running the agent in the background before
 * the web app exists (`--inbox runs/<case>/inbox.txt`). A line "край" ends the conversation.
 */
export function fileInput(file: string, pollMs = 1000): Input {
  if (!existsSync(file)) writeFileSync(file, "");
  let offset = statSync(file).size; // only lines written after the start count
  let buffer = "";
  let closed = false;

  const readNew = (): void => {
    const size = statSync(file).size;
    if (size <= offset) return;
    const fd = openSync(file, "r");
    const chunk = Buffer.alloc(size - offset);
    readSync(fd, chunk, 0, chunk.length, offset);
    closeSync(fd);
    offset = size;
    buffer += chunk.toString("utf8");
  };

  return {
    async next(prompt = "") {
      if (prompt) process.stdout.write(prompt);
      while (!closed) {
        readNew();
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          process.stdout.write(`\n> ${line}\n`);
          return line;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return undefined;
    },
    close: () => {
      closed = true;
    },
  };
}
