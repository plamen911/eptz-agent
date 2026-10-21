import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CostLog } from "../costLog.js";
import { costUsd } from "../pricing.js";
import { READER_SYSTEM, RECORD_PAGE_TOOL } from "./prompt.js";

export const Page = z.object({
  document_type: z.string(),
  script: z.enum(["printed", "handwritten", "mixed"]),
  text: z.string(),
  handwritten_numbers: z.array(z.object({ value: z.string(), context: z.string() })),
});
export type Page = z.infer<typeof Page>;

const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_BYTES = 5 * 1024 * 1024; // the API's limit for one base64 image

/** The page from the model's tool call; throws when the model did not answer through the tool. */
export function pageFromResponse(content: Anthropic.Messages.ContentBlock[]): Page {
  const call = content.find((block) => block.type === "tool_use" && block.name === RECORD_PAGE_TOOL.name);
  if (!call || call.type !== "tool_use") throw new Error("The reader did not call record_page");
  return Page.parse(call.input);
}

export interface ReaderOptions {
  client: Anthropic;
  model: string;
  caseId: string;
  log: CostLog;
}

/**
 * One photo → one page of text, by the reader model. Retries and timeouts are the client's
 * (maxRetries, timeout); the system prompt is cached, so pages 2…N of a case read it at the
 * cache price.
 */
export async function readPage(path: string, { client, model, caseId, log }: ReaderOptions): Promise<Page> {
  const mediaType = MEDIA[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported image type: ${path} (JPEG, PNG or WebP)`);
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error(`${path} is larger than 5 MB`);

  const started = Date.now();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: [{ type: "text", text: READER_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [RECORD_PAGE_TOOL],
      tool_choice: { type: "tool", name: RECORD_PAGE_TOOL.name },
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } }],
        },
      ],
    });
    const usage = response.usage;
    log.add({
      caseId,
      step: "transcribe",
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: costUsd(model, usage),
      ms: Date.now() - started,
      outcome: "ok",
    });
    if (response.stop_reason === "max_tokens") throw new Error(`${path}: the transcription was cut off (max_tokens)`);
    return pageFromResponse(response.content);
  } catch (error) {
    log.add({
      caseId,
      step: "transcribe",
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
      ms: Date.now() - started,
      outcome: "error",
      detail: error instanceof Error ? error.constructor.name : "unknown",
    });
    throw error;
  }
}
