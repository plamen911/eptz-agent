import Anthropic from "@anthropic-ai/sdk";
import { factsOfCase, prefetch } from "../agent/prefetch.js";
import { startCase } from "../agent/session.js";
import type { Config } from "../config.js";
import type { CostLog } from "../costLog.js";
import { numbersToConfirm, readFolder } from "../transcribe/folder.js";
import type { Engine } from "./manager.js";

/** The real engine: Haiku reads the photos and the facts, the Agent SDK runs Sonnet with the skill. */
export function claudeEngine(config: Config, log: CostLog): Engine {
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  return {
    async readPhotos(photosDir, caseDir, caseId, onPage) {
      const pages = await readFolder(photosDir, caseDir, { client, model: config.READER_MODEL, caseId, log }, onPage);
      return numbersToConfirm(pages);
    },
    facts: (caseDir, caseId) => factsOfCase(config, caseDir, client, log, caseId),
    prefetch: (caseDir, facts, expert) => prefetch(config, caseDir, facts, expert),
    startCase: (caseId, budgetUsd, hooks, resume) =>
      startCase({ ...config, CASE_BUDGET_USD: Math.max(budgetUsd, 0.01) }, caseId, log, hooks, resume),
  };
}
