import { describe, expect, it } from "vitest";
import { mapLimited, numbersToConfirm, toMarkdown } from "../src/transcribe/folder.js";
import { pageFromResponse } from "../src/transcribe/reader.js";

const page = {
  document_type: "ПРОТОКОЛ ЗА ОГЛЕД",
  script: "handwritten" as const,
  text: "Контейнерите са с размери 1,25 х 1,20 х 1 м.",
  handwritten_numbers: [{ value: "1,25 х 1,20 х 1", context: "размери на черните контейнери" }],
};

describe("pageFromResponse", () => {
  it("takes the page from the record_page call", () => {
    const parsed = pageFromResponse([{ type: "tool_use", id: "t1", name: "record_page", input: page, caller: { type: "direct" } }]);
    expect(parsed.handwritten_numbers).toHaveLength(1);
  });

  it("fails loudly when the model answered with text instead", () => {
    expect(() => pageFromResponse([{ type: "text", text: "…", citations: null }])).toThrow(/record_page/);
  });

  it("rejects a page that does not match the schema", () => {
    const bad = { ...page, script: "typed" };
    expect(() => pageFromResponse([{ type: "tool_use", id: "t1", name: "record_page", input: bad, caller: { type: "direct" } }])).toThrow();
  });
});

describe("case materials", () => {
  const pages = [{ file: "photo_04.jpeg", ...page }];

  it("writes one section per page, in order", () => {
    const md = toMarkdown(pages);
    expect(md).toContain("## Страница 1 – photo_04.jpeg");
    expect(md).toContain("ПРОТОКОЛ ЗА ОГЛЕД (handwritten)");
  });

  it("lists the handwritten numbers with their page", () => {
    expect(numbersToConfirm(pages)).toEqual([{ file: "photo_04.jpeg", value: "1,25 х 1,20 х 1", context: "размери на черните контейнери" }]);
  });
});

describe("mapLimited", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, n * 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
