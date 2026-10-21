import type { HandwrittenNumber, Status } from "./types";

export const STATUS: Record<Status, string> = {
  new: "Снимки",
  reading: "Разчитане",
  read: "За проверка",
  ready: "Готово",
  writing: "Пише",
  interrupted: "Прекъснато",
  error: "Грешка",
};

export const usd = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

/** 2026-05-14 → 14.05.2026 */
export const bgDate = (iso: string) => iso.split("-").reverse().join(".");

export const bgDateTime = (iso: string) =>
  new Date(iso).toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Handwritten numbers that usually go into the conclusion – sizes, distances, times, dates,
 * registration numbers – first; the rest (page numbers, signatures' dates …) after them.
 */
const MATTERS = /(размер|височин|дължин|ширин|диаметър|дълбочин|разстояни|площ|обем|час|време|дата|рег\.?\s*№|регистрац|номер|№|ЕГН|км|\bм\b|\bсм\b|\bмм\b|\bм2\b|°)/i;

export function sortNumbers<T extends HandwrittenNumber>(numbers: T[]): { important: T[]; other: T[] } {
  const important: T[] = [];
  const other: T[] = [];
  for (const n of numbers) (MATTERS.test(n.context) ? important : other).push(n);
  return { important, other };
}

/** Tool steps in words the expert knows. */
export function stepLabel(name: string, summary: string): string {
  if (name === "Skill") return "Методиката за ЕПТЗ";
  if (name === "Read") return `Чете ${summary}`;
  if (name === "Write") return `Пише ${summary}`;
  if (name === "Edit") return `Поправя ${summary}`;
  if (/build_eptz_docx/.test(summary)) return "Сглобява документа";
  if (/build_smetka/.test(summary)) return "Сметката";
  if (/pregled/.test(summary)) return "Проверява документа";
  if (/soffice|pdfinfo/.test(summary)) return "Брои страниците";
  if (/obraztsi/.test(summary)) return "Търси одобрени експертизи";
  if (/metar|nachalo/.test(summary)) return "Метеорологичните данни";
  if (/grep|sed|cat|head|awk/.test(summary)) return "Справка в материалите";
  return "Команда";
}
