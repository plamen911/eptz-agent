import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** The agent's text as it streams, its tool steps, and the running cost. */
export function print(message: SDKMessage): void {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") process.stdout.write(event.delta.text);
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      process.stdout.write(`\n  · ${event.content_block.name}\n`);
    }
  } else if (message.type === "result") {
    const cost = message.total_cost_usd.toFixed(3);
    process.stdout.write(`\n\n[${message.subtype}] ${cost} USD до момента, ${message.num_turns} хода\n> `);
  } else if (message.type === "system" && message.subtype === "init") {
    process.stdout.write(`[скилове: ${message.skills.filter((s) => s.startsWith("fire-service")).join(", ")}]\n`);
  }
}
