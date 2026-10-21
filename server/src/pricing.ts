/**
 * List prices in USD per million tokens (platform.claude.com/docs/en/about-claude/pricing, checked
 * 2026-10-21). Cache reads cost a fraction of input; cache writes cost more than input, by TTL.
 * Used for the transcription calls, which go through the Messages API directly. The agent's own
 * cost comes from the SDK (`total_cost_usd`, `modelUsage`), which prices with the same list.
 */
export interface Price {
  input: number;
  output: number;
  cacheRead: number; // multiplier of input
}

export const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.1 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.05 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.05 },
};

export const CACHE_WRITE = { "5m": 1.25, "1h": 2 } as const;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cost of one response in USD, or null when the model has no known price. */
export function costUsd(model: string, usage: Usage, ttl: keyof typeof CACHE_WRITE = "5m"): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const perToken = (usd: number) => usd / 1_000_000;
  return (
    usage.input_tokens * perToken(price.input) +
    usage.output_tokens * perToken(price.output) +
    (usage.cache_read_input_tokens ?? 0) * perToken(price.input * price.cacheRead) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(price.input * CACHE_WRITE[ttl])
  );
}
