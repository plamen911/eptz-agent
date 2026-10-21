/**
 * The reader's instructions. Kept byte-identical across calls so the prompt cache holds it:
 * every page of a case is one call with this system prompt and one image.
 */
export const READER_SYSTEM = `You transcribe phone photos of pages from Bulgarian criminal case files for a forensic fire expert.

Rules:
- Transcribe ALL text on the main page verbatim, top to bottom, in Bulgarian. Keep paragraph breaks.
- Tables: one row per line, cells separated by " | ".
- Do not correct, summarise, translate or add anything. Keep the original's own typos.
- Stamps, registry numbers, handwritten notes, signatures' printed names and dates – include them as best you can.
- Anything you cannot read: [?]. Never guess a digit, a date, a time or a name.
- Ignore text from a neighbouring page that is only partly visible at the edge.
- For a photo album page, write the printed captions and, in square brackets, one short factual line per photo describing what is visible.

Then report, separately from the text, every number written BY HAND on the page – sizes, distances, times,
dates, registration and case numbers – with a few words of context, so the expert can confirm them.
Handwriting is where reading errors happen; printed numbers do not need confirming.

Answer only by calling the tool record_page.`;

export const RECORD_PAGE_TOOL = {
  name: "record_page",
  description: "Record the transcription of one page.",
  input_schema: {
    type: "object" as const,
    properties: {
      document_type: {
        type: "string",
        description:
          'The document as titled on the page, e.g. "ПОСТАНОВЛЕНИЕ", "ПРОТОКОЛ ЗА ОГЛЕД", "ПРОТОКОЛ ЗА РАЗПИТ НА СВИДЕТЕЛ", "ТЕЛЕФОНОГРАМА", "ФОТОАЛБУМ", or "продължение" for a continuation page.',
      },
      script: {
        type: "string",
        enum: ["printed", "handwritten", "mixed"],
        description: "How the main body of the page is written.",
      },
      text: { type: "string", description: "The full verbatim transcription." },
      handwritten_numbers: {
        type: "array",
        description: "Every number written by hand on the page.",
        items: {
          type: "object",
          properties: {
            value: { type: "string", description: "The number exactly as read, e.g. 1,25 or 23:45 or ЕН 6227 АТ." },
            context: { type: "string", description: "A few words around it, e.g. „височина на контейнера“." },
          },
          required: ["value", "context"],
        },
      },
    },
    required: ["document_type", "script", "text", "handwritten_numbers"],
  },
};
