# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An agent that drafts a Bulgarian forensic fire expert's report (ЕПТЗ) and fee sheet from phone photos of a case file: a Fastify server, a React PWA, and the Claude Agent SDK. npm workspaces: `server/`, `web/`. Node 22+. The README covers the product, the API routes, and the cost figures.

## Commands

```sh
npm install
npm run vendor:plugin    # fetch the fire-service plugin into vendor/ (gitignored) at the plugin.lock commit
npm run typecheck        # both workspaces
npm test                 # both workspaces; no API key or vendored plugin needed
npm run build            # web/dist (typechecks first)
npm run check:plugin     # the agent loads the vendored plugin at the pinned version; no API call

npm test --workspace server -- test/guard.test.ts            # one test file
npm test --workspace server -- test/guard.test.ts -t "name"  # one test (same for --workspace web)

npm run serve            # API, plus the app if web/dist is built – http://127.0.0.1:8787
npm run dev:web          # Vite with hot reload; proxies /api to npm run serve
ENGINE=demo npm run serve                                    # invented case, no model calls
npm run case -- ./cases/my-case                              # a whole case in the terminal
npm run turn -- --case ID --photos DIR [--message TEXT]      # one turn, then exit
```

There is no linter. CI runs `vendor:plugin`, `typecheck`, `test`, `build`, `check:plugin`. Settings come from `.env` (see `.env.example`), validated in `server/src/config.ts`.

## Architecture

**Two models, one pipeline.** The reader (Haiku, direct Anthropic SDK, `server/src/transcribe/`) turns photos into `case_ingest.md` and `handwritten_numbers.json`, one call per page. The writer (Sonnet, Agent SDK, `server/src/agent/session.ts`) only ever sees that text: photos live in `runs/_photos/<id>/`, outside the agent's folder `runs/<id>/`, on purpose. Finished documents go in `runs/<id>/out/`, and the app offers whatever `.docx`/`.xlsx`/`.pdf` is there for download.

**The methodology is not in this repo.** It is the `fire-service:eptz` skill from an external plugin, vendored at the commit pinned in `plugin.lock`. Don't edit `vendor/`. The hourly `sync-plugin` workflow bumps `plugin.lock` when this repo's checks still pass against it, which is why most commits are plugin updates. This code depends on the plugin's layout in two places: `agent/prompt.ts` inlines fixed skill files into the system prompt, and `agent/prefetch.ts` runs the skill's first command.

**Case lifecycle** (`server/src/cases/`): `new → reading → read → ready → writing → ready …`. A restart during work gives `interrupted`. `CaseManager` holds per-case state in memory, persists it to `runs/<id>/state.json`, and allows one piece of work per case at a time. Each expert message is one agent turn; the next turn resumes through the saved SDK `sessionId`. Everything reaches the browser as events (`events.ts`) over SSE.

**Seams worth knowing:**
- The `Engine` interface in `manager.ts` holds all model-facing work. `engine.ts` is the real one, `demoEngine.ts` backs `ENGINE=demo`, and tests pass a fake.
- `cases/progress.ts` is imported directly by the web app (`web/src/useCase.ts`) so both sides fold events identically. It must import nothing beyond the event type.
- `cases/firstMessage.ts` puts confirmed facts and prefetched data into the first turn, and `agent/prompt.ts` holds the system prompt. Both are in Bulgarian, as is the app's UI; code and comments are in English.

## Invariants

- **Agent permissions have three layers:** the `tools` list and options in `caseOptions` (`session.ts`), the `PreToolUse` guard (`agent/guard.ts`, which denies unknown tools by default), and the OS sandbox for Bash (`failIfUnavailable: true`). A new tool or data host has to be added in the relevant layer; `server/test/session.test.ts` and `guard.test.ts` pin this behaviour.
- **Nothing leaves the app.** `poshta.py` and `obraztsi.py zapis` are refused in Bash. The approval path (`canUseTool`, approval events, the UI card) stays for future outward actions, but no call reaches it today since the guard never returns `ask`.
- **The agent's environment is minimal** (`PASSED_ENV` plus the two keys), and `settingSources: []` with `mcpServers: {}` keeps machine config out. This repo's own CLAUDE.md never reaches the agent.
- **Cost is cumulative.** SDK totals carry across resumed turns, so the agent's budget is `CASE_BUDGET_USD` minus reading cost, and `state.agentCostUsd` is overwritten, not added to.
- **Cache-sensitive flow.** The expert confirms facts before the agent starts so it can write the whole report in one turn; a pause past the cache TTL costs a new cache write. Avoid changes that make the agent stop and ask, or that vary the system prompt between cases.
- **Case data never enters git.** `cases/` and `runs/` hold personal data and are ignored. Demos and fixtures use invented cases.
- **Exposure rules in config:** `SANDBOX=off` is refused unless `HOST` is localhost, and `http/main.ts` refuses a non-localhost `HOST` without `APP_TOKEN`.

## Production

The app runs on the fire-expert.uk box (`deploy@46.224.114.108`) as the systemd service `eptz-agent`, deployed with `./deploy.sh` (`--help` lists the options). These settings live only on the server:

- **`/etc/hosts` has `172.18.0.5 n8n.fire-expert.uk`.** The agent's sandbox refuses a domain that resolves to one of the host's own addresses, and n8n runs on this same box, so the name points at the `laravel_rag_nginx` container instead. Without the line, the skill's scripts fail inside the sandbox with `N8N_UNAVAILABLE ... 403 Forbidden`. The address can change when that container is recreated; if it does, update the line with `docker inspect laravel_rag_nginx --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`.
