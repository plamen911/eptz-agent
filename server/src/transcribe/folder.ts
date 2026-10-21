import { readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Page, type ReaderOptions, readPage } from "./reader.js";

export interface ReadPage extends Page {
  file: string;
}

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** Runs `work` over `items` with at most `limit` at a time, keeping the input order in the result. */
export async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** The case materials as one Markdown file – the input the eptz skill reads as case_ingest.md. */
export function toMarkdown(pages: ReadPage[]): string {
  const parts = pages.map(
    (p, i) => `## Страница ${i + 1} – ${p.file}\n\nДокумент: ${p.document_type} (${p.script})\n\n${p.text.trim()}\n`,
  );
  return `# Материали по делото\n\nРазчетени от снимки. „[?]“ – нечетимо.\n\n${parts.join("\n")}`;
}

/** Every handwritten number, for the expert to confirm before the writing starts. */
export function numbersToConfirm(pages: ReadPage[]) {
  return pages.flatMap((p) => p.handwritten_numbers.map((n) => ({ file: p.file, ...n })));
}

/**
 * Reads every photo in `dir` (sorted by name) with the reader model, three at a time,
 * and writes case_ingest.md and handwritten_numbers.json into `outDir`.
 */
export async function readFolder(
  dir: string,
  outDir: string,
  options: ReaderOptions,
  onPage?: (done: number, total: number) => void,
): Promise<ReadPage[]> {
  const files = (await readdir(dir)).filter((f) => IMAGE.test(f)).sort();
  if (files.length === 0) throw new Error(`No JPEG, PNG or WebP photos in ${dir}`);
  let done = 0;
  const pages = await mapLimited(files, 3, async (file) => {
    const page = await readPage(join(dir, file), options);
    onPage?.(++done, files.length);
    return { file: basename(file), ...page };
  });
  await writeFile(join(outDir, "case_ingest.md"), toMarkdown(pages));
  await writeFile(join(outDir, "handwritten_numbers.json"), JSON.stringify(numbersToConfirm(pages), null, 2));
  return pages;
}
