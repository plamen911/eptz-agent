import { readdir } from "node:fs/promises";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CaseSession } from "../agent/session.js";
import type { Engine } from "./manager.js";

/**
 * ENGINE=demo: the whole flow without a model call – for trying the app, for the browser tests
 * and for a public demo that costs nothing. Reading takes a moment per photo; the writing streams
 * an invented case's summary, shows its steps and asks one approval.
 */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REPLY = `Прочетох материалите и написах заключението.

**Причина:** най-вероятно злонамерено внесен външен източник на открит пламък. Природните сили и късото съединение отпадат, небрежността е малко вероятна.

Какво да проверите:
- Часът на локализиране – в протокола е 23:45 ч., в докладната 23:48 ч.
- Размерите на контейнера – 1,40 × 1,00 × 1,20 м, както ги потвърдихте.

Това е демонстрация: делото е измислено и документи не се създават.`;

export function demoEngine(stepMs = 250): Engine {
  return {
    async readPhotos(photosDir, _caseDir, _caseId, onPage) {
      const files = (await readdir(photosDir)).sort();
      for (let i = 0; i < files.length; i++) {
        await pause(stepMs * 2);
        onPage(i + 1, files.length);
      }
      const first = files[0] ?? "001-demo.jpg";
      const last = files.at(-1) ?? first;
      return [
        { file: first, value: "1,4", context: "височина на контейнера, м" },
        { file: first, value: "23:45", context: "час на локализиране" },
        { file: last, value: "EH 1234 AB", context: "рег. № на автомобила на паркинга" },
        { file: last, value: "3", context: "номер на страницата" },
      ];
    },
    facts: async () => ({ fire_date: "2026-05-14", place: "Плевен" }),
    prefetch: async () => "(демо – без данни от скила)",
    startCase(_caseId, _budget, hooks, resume): CaseSession {
      let close!: () => void;
      const done = new Promise<void>((r) => (close = r));
      const emit = (m: unknown) => hooks.onMessage(m as SDKMessage);
      const tool = (name: string, command: string) =>
        emit({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { command, skill: command } }] } });
      return {
        send() {
          void (async () => {
            emit({ type: "system", subtype: "init", session_id: resume ?? `demo-${Date.now()}` });
            tool("Skill", "fire-service:eptz");
            await pause(stepMs * 3);
            tool("Bash", "grep -n 'час' case_ingest.md");
            await pause(stepMs * 3);
            tool("Bash", "python3 $D/scripts/build_eptz_docx.py meta.json report.md");
            await pause(stepMs * 2);
            tool("Bash", "python3 $D/scripts/pregled.py out/demo.docx");
            await hooks.approve("изпращане по и-мейл", "python3 _shared/scripts/poshta.py --to expert@example.com out/demo.docx");
            for (const word of REPLY.split(/(?<=\s)/)) {
              emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: word } } });
              await pause(stepMs / 10);
            }
            emit({ type: "result", subtype: "success", total_cost_usd: 0, num_turns: 4, modelUsage: {} });
          })();
        },
        close: () => close(),
        done,
      };
    },
  };
}
