import type { CaseState, Confirmation } from "./state.js";

const bgDate = (iso: string) => iso.split("-").reverse().join(".");

/**
 * The agent's first message: the task, everything the expert already confirmed on the check screen
 * (so the agent does not stop to ask – a pause past the 5-minute cache costs a new cache write), any
 * words of his own, and the data the app fetched for the skill's first steps.
 */
export function firstMessage(state: Pick<CaseState, "expert">, confirmed: Confirmation, prefetched: string, text?: string): string {
  const lines = [
    "Изготви ЕПТЗ и сметката по материалите в case_ingest.md." +
      (state.expert ? ` Вещото лице е ${state.expert} (данните му – по-долу, от списъка на служителите).` : ""),
    "Експертът вече прегледа материалите и потвърди следното – не питай отново за тях:",
    `- Пожарът е на ${bgDate(confirmed.fire_date)} г. в ${confirmed.place}.`,
  ];
  if (confirmed.numbers.length > 0) {
    lines.push("- Числата, писани на ръка:");
    for (const n of confirmed.numbers) {
      const changed = n.confirmed !== n.value ? ` (разчетено като „${n.value}“ – грешно)` : "";
      lines.push(`  - ${n.context}: ${n.confirmed}${changed} [${n.file}]`);
    }
  }
  if (confirmed.notes.trim()) lines.push("", "Бележки на експерта:", confirmed.notes.trim());
  if (text?.trim()) lines.push("", text.trim());
  lines.push("", "Генерирай заключението и сметката направо, без да питаш за съгласие.");
  lines.push("", "# Данни, събрани от приложението", "", prefetched);
  return lines.join("\n");
}
