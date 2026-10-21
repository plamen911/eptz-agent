import { describe, expect, it } from "vitest";
import { costUsd } from "../src/pricing.js";

describe("costUsd", () => {
  it("prices input, output and the cache by model", () => {
    // Haiku 5.5: 1600 input × 0.10 + 1000 output × 0.50 per million
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1600, output_tokens: 1000 })).toBeCloseTo(0.00066, 8);
    // Sonnet 5.5 cache read is 0.05 × input, a 5-minute cache write 1.25 ×
    const cached = costUsd("claude-sonnet-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cached).toBeCloseTo(0.1 + 2.5, 8);
  });

  it("returns null for an unknown model rather than a wrong number", () => {
    expect(costUsd("claude-unknown", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
