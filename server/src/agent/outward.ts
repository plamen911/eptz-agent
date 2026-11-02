import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { inside, type Roots } from "./guard.js";

const run = promisify(execFile);

/**
 * The only ways anything leaves the app: e-mail and saving a report as a template. They are the
 * app's own tools, not commands the agent writes in Bash – the guard marks both "ask", so each call
 * reaches the expert first, and the script runs in the server process with fixed arguments (no
 * shell), not in the agent's sandbox. Bash calls to the same scripts are refused by the guard.
 */

export const SERVER = "eptz";
export const SEND_EMAIL = `mcp__${SERVER}__send_email`;
export const SAVE_TEMPLATE = `mcp__${SERVER}__save_template`;
/** The tools that leave the app – the guard asks the expert before each call. */
export const OUTWARD_TOOLS: Record<string, string> = {
  [SEND_EMAIL]: "изпращане по и-мейл",
  [SAVE_TEMPLATE]: "запис на образец в базата с одобрени експертизи",
};

const FILE_NAME = /^[\p{L}\p{N}._ -]+\.(docx|xlsx|pdf|md|txt)$/u;
const ADDRESS = z.union([z.literal("az"), z.email()]);

export const EmailInput = {
  to: z.array(ADDRESS).min(1).max(10).describe("получатели; „az“ = собственият адрес на експерта"),
  subject: z.string().min(1).max(200),
  text: z.string().max(5_000).default(""),
  files: z.array(z.string().regex(FILE_NAME)).max(10).default([]).describe("имена на файлове от out/"),
};

export const TemplateInput = {
  file: z.string().regex(/^[A-Za-z0-9_.-]+\.md$/).describe("анонимизираният образец в текущата папка, .md"),
  obekt: z.string().min(1).max(200),
  prichina: z.string().min(1).max(200),
  belezhka: z.string().min(1).max(500),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("дата на пожара ГГГГ-ММ-ДД"),
};

type Email = z.infer<z.ZodObject<typeof EmailInput>>;
type Template = z.infer<z.ZodObject<typeof TemplateInput>>;

/** A path in the case folder, or an error – names only, never a path the agent chose. */
function caseFile(roots: Roots, dir: string, name: string): string {
  const path = join(roots.caseDir, dir, basename(name));
  if (!inside(roots.caseDir, path) || !existsSync(path)) throw new Error(`NO_DATA: няма файл ${join(dir, basename(name))}`);
  return path;
}

/** poshta.py's arguments for one e-mail – exported for the tests. */
export function emailArgs(roots: Roots, a: Email): string[] {
  const args = [join(roots.plugin, "shared/scripts/poshta.py"), "--tema", a.subject, "--json"];
  for (const to of a.to) args.push("--do", to);
  if (a.text) args.push("--tekst", a.text);
  for (const f of a.files) args.push(caseFile(roots, "out", f));
  return args;
}

/** obraztsi.py's arguments for saving one ЕПТЗ template – exported for the tests. */
export function templateArgs(roots: Roots, a: Template): string[] {
  return [
    join(roots.plugin, "shared/scripts/obraztsi.py"), "zapis", "eptz", caseFile(roots, ".", a.file),
    "--obekt", a.obekt, "--prichina", a.prichina, "--belezhka", a.belezhka, "--data", a.data,
  ];
}

async function script(roots: Roots, env: Record<string, string>, args: string[]) {
  try {
    const { stdout } = await run("python3", args, { cwd: roots.caseDir, env, timeout: 200_000 });
    return { content: [{ type: "text" as const, text: stdout.trim() || "ok" }] };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string };
    const text = (err.stderr || err.stdout || err.message).trim().slice(0, 800);
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

export function outwardServer(roots: Roots, agentEnv: Record<string, string>) {
  // the scripts need the n8n key, not the model key
  const { ANTHROPIC_API_KEY: _model, ...env } = agentEnv;
  const wrap = <T>(build: (a: T) => string[]) => async (a: T) => {
    let args: string[];
    try {
      args = build(a);
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }
    return script(roots, env, args);
  };
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "send_email",
        "Изпраща готови документи от out/ по и-мейл (през n8n). Експертът одобрява всяко изпращане. Само при изрична молба.",
        EmailInput,
        wrap((a: Email) => emailArgs(roots, a)),
      ),
      tool(
        "save_template",
        "Записва анонимизирано заключение като образец (вид eptz) в базата с одобрени експертизи. Експертът одобрява всеки запис. Само при изрична молба.",
        TemplateInput,
        wrap((a: Template) => templateArgs(roots, a)),
      ),
    ],
  });
}
