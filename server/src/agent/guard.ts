import { isAbsolute, relative, resolve } from "node:path";

/**
 * What the agent may touch. The OS sandbox (bubblewrap on Linux) confines Bash – writes only in
 * the case folder, network only to the allowed hosts. This guard covers the file tools, which do
 * not run in the sandbox, and marks the actions that leave the app for the expert's approval.
 */
export interface Roots {
  /** The vendored fire-service plugin – read only. */
  plugin: string;
  /** This case's working folder – the only place the agent writes. */
  caseDir: string;
}

export type Decision = { decision: "allow" } | { decision: "deny"; reason: string } | { decision: "ask"; reason: string };

/** Commands that send or publish something: they run only after the expert approves them. */
export const OUTWARD: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bposhta\.py\b(?![^\n]*--dry-run)/, reason: "изпращане по и-мейл" },
  { pattern: /\bobraztsi\.py\b[^\n]*\bzapis\b/, reason: "запис на образец в базата с одобрени експертизи" },
];

export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pathOf(input: Record<string, unknown>, key: string, cwd: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string" || value === "") return undefined;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function checkTool(tool: string, input: Record<string, unknown>, roots: Roots): Decision {
  const readable = (p: string) => inside(roots.plugin, p) || inside(roots.caseDir, p);
  switch (tool) {
    case "Read":
    case "Glob":
    case "Grep": {
      const path = pathOf(input, tool === "Read" ? "file_path" : "path", roots.caseDir);
      if (path && !readable(path)) return { decision: "deny", reason: `${tool} outside the case and the plugin: ${path}` };
      return { decision: "allow" };
    }
    case "Write":
    case "Edit": {
      const path = pathOf(input, "file_path", roots.caseDir);
      if (!path || !inside(roots.caseDir, path)) return { decision: "deny", reason: `${tool} outside the case folder` };
      return { decision: "allow" };
    }
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : "";
      const outward = OUTWARD.find((o) => o.pattern.test(command));
      if (outward) return { decision: "ask", reason: outward.reason };
      return { decision: "allow" }; // confined by the sandbox
    }
    case "Skill":
      return { decision: "allow" };
    default:
      // the agent's own MCP tools decide for themselves; anything else is not part of this app
      if (tool.startsWith("mcp__eptz__")) return { decision: "allow" };
      return { decision: "deny", reason: `${tool} is not available in this app` };
  }
}
