import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CanUseTool,
  type HookCallback,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config.js";
import type { CostLog } from "../costLog.js";
import { checkTool, type Roots } from "./guard.js";
import { systemPrompt } from "./prompt.js";

/** A queue the SDK reads the expert's messages from (streaming input mode). */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private waiting: ((m: IteratorResult<SDKUserMessage>) => void) | undefined;
  private queued: SDKUserMessage[] = [];
  private closed = false;

  push(text: string): void {
    const message: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: message, done: false });
    } else this.queued.push(message);
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.queued.shift();
        if (message) return Promise.resolve({ value: message, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

export interface SessionHooks {
  /** Every SDK message – the CLI prints them, the server will stream them over SSE. */
  onMessage(message: SDKMessage): void;
  /** The expert's answer to an action that leaves the app (e-mail, saving a template). */
  approve(action: string, detail: string): Promise<boolean>;
}

export interface CaseSession {
  send(text: string): void;
  close(): void;
  /** Resolves when the SDK has finished – after close(), or when the budget or turns run out. */
  done: Promise<void>;
}

/** The SDK options for one case – exported so a test can check what the agent is allowed. */
export function caseOptions(config: Config, roots: Roots, hooks: SessionHooks): Options {
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const verdict = checkTool(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, roots);
    if (verdict.decision === "allow") return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: verdict.decision,
        permissionDecisionReason: verdict.reason,
      },
    };
  };

  // reached only for calls the guard marked "ask" – everything else is decided before it
  const canUseTool: CanUseTool = async (toolName, input) => {
    const detail = typeof input.command === "string" ? input.command : JSON.stringify(input);
    const verdict = checkTool(toolName, input, roots);
    const reason = verdict.decision === "ask" ? verdict.reason : toolName;
    return (await hooks.approve(reason, detail))
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Експертът не одобри действието." };
  };

  // Only what the agent needs – not the whole environment of the server process.
  const env: Record<string, string> = { ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY };
  for (const name of ["PATH", "HOME", "LANG", "TZ", "TMPDIR"]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  if (config.FIRE_SERVICE_KEY) env.FIRE_SERVICE_KEY = config.FIRE_SERVICE_KEY;

  return {
    cwd: roots.caseDir,
    model: config.WRITER_MODEL,
    fallbackModel: config.WRITER_FALLBACK_MODEL,
    systemPrompt: systemPrompt(roots),
    // no user or project settings, CLAUDE.md or personal skills – only what this app passes
    settingSources: [],
    plugins: [{ type: "local", path: roots.plugin }],
    skills: ["fire-service:eptz"],
    tools: ["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    // no MCP servers from the machine's configuration – only the ones this app registers
    mcpServers: {},
    strictMcpConfig: true,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: ["n8n.fire-expert.uk", "mesonet.agron.iastate.edu"] },
      filesystem: { allowWrite: [roots.caseDir, tmpdir()] },
    },
    hooks: { PreToolUse: [{ hooks: [guard] }] },
    canUseTool,
    includePartialMessages: true,
    maxBudgetUsd: config.CASE_BUDGET_USD,
    maxTurns: 120,
    env,
  };
}

/**
 * One case, one conversation with the agent. `resume` continues a saved session (the SDK keeps the
 * transcript), so a case can span several processes – a request per turn on the server, or the
 * terminal runner exiting between answers.
 */
export function startCase(
  config: Config,
  caseId: string,
  log: CostLog,
  hooks: SessionHooks,
  resume?: string,
): CaseSession {
  const roots: Roots = { plugin: config.PLUGIN_DIR, caseDir: join(config.RUNS_DIR, caseId) };
  const inbox = new Inbox();
  const started = Date.now();
  const options = caseOptions(config, roots, hooks);
  if (resume) options.resume = resume;
  const stream = query({ prompt: inbox, options });

  const done = (async () => {
    for await (const message of stream) {
      hooks.onMessage(message);
      if (message.type === "result") {
        // cumulative for the session – each result carries the running total
        for (const [model, usage] of Object.entries(message.modelUsage)) {
          log.add({
            caseId,
            step: "agent",
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadInputTokens,
            cacheWriteTokens: usage.cacheCreationInputTokens,
            costUsd: usage.costUSD,
            ms: Date.now() - started,
            outcome: message.subtype === "success" ? "ok" : message.subtype === "error_max_budget_usd" ? "budget" : "error",
            detail: `turn total ${message.total_cost_usd.toFixed(4)} USD`,
          });
        }
      }
    }
  })();

  return { send: (text) => inbox.push(text), close: () => inbox.close(), done };
}
