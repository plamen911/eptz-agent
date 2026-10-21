# eptz-agent

An agent that drafts a forensic fire expert's report – ЕПТЗ (експертно пожаро-техническо
заключение) – for a Bulgarian criminal case, from phone photos of the case file.

It is built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) and
reuses the methodology of the [fire-service plugin](https://github.com/plamen911/fire-service-skills),
which already produces court-ready reports inside Claude's apps.

**Status:** step 0 – the agent runs from the terminal. The web app (React, SSE streaming,
approvals in the UI) is next. See [the plan](#plan).

## How it works

```
photos ──► reader (Claude Haiku 5.5) ──► case_ingest.md + handwritten_numbers.json
                one call per page, cached prompt, structured output
                                   │
                                   ▼
           writer (Claude Sonnet 5.5, Agent SDK) ──► ЕПТЗ .docx + fee .xlsx
                fire-service:eptz skill, Python builders, OS sandbox
```

- **Two models, each for what it is good at.** On real case photos, Haiku found 46 of 47 checked
  facts for about a cent per 15 pages; Sonnet writes the report. The writer never sees a photo,
  only the text, so the images are paid for once.
- **Handwriting is confirmed by a person.** The reader lists every number written by hand
  (sizes, times, dates, registration numbers). In an early test a misread handwritten size went
  straight into a report; now the expert confirms these before the writing starts.
- **The skill is loaded, not copied.** `plugins` loads the fire-service plugin pinned in
  `plugin.lock`, and `skills: ["fire-service:eptz"]` makes the ЕПТЗ skill the only one the agent
  can invoke. A short own system prompt replaces Claude Code's; no user or project settings load.

## Safety

- **Bash runs in the OS sandbox** (bubblewrap on Linux): it writes only in the case folder and
  reaches only the two data hosts (the n8n knowledge base and the METAR archive).
- **A `PreToolUse` hook** keeps the file tools inside the case folder and the plugin, refuses
  tools the app does not offer, and sends anything that leaves the app – e-mail, saving a report
  as a template – to the expert for approval (`canUseTool`).
- **The agent gets a minimal environment**: the API key, the optional n8n key and a few system
  variables – not the server's environment – and no MCP servers from the machine.
- **Case files never enter git.** `cases/` and `runs/` are ignored; the public demo uses an
  invented case.

## Cost control

- `maxBudgetUsd` stops a case at `CASE_BUDGET_USD` (an SDK estimate – keep headroom).
- Every model call is logged to `runs/costs.jsonl`: model, tokens (incl. cache), cost, time, outcome.
- The reader's prompt is cached across the pages of a case; the client retries with backoff and
  times out after 120 s.

## Run it

Requirements: Node 22+, Python 3 with `python-docx` and `openpyxl`, and on Linux `bubblewrap` and
`socat` for the sandbox.

```sh
npm install
npm run vendor:plugin           # fetches the fire-service plugin at the pinned commit
cp .env.example .env            # add ANTHROPIC_API_KEY (and FIRE_SERVICE_KEY, if you have one)
npm run case -- ./cases/my-case # a folder of JPEG/PNG/WebP photos
npm test
```

## Plan

0. Agent in the terminal: reader, writer, sandbox, approvals, cost log. ← here
1. Server: Fastify, a case API, SSE streaming of the agent's text and steps.
2. React + TypeScript PWA: upload from the camera with progress, confirm handwritten numbers,
   approve actions, download the documents.
3. Compaction: a `PreCompact` hook keeps a case dossier so the agent never asks twice.
4. Production basics: retries and fallbacks end to end, per-case budget in the UI, metrics page.
5. Evals in CI: reading accuracy on a fixed set of pages, report checks, a regression threshold.
6. Public demo on an invented case, and a case study with real numbers.

## License

All rights reserved for now; a license will be added before the public demo.
