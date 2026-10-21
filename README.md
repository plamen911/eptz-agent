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

## The server

A Fastify server (`npm run serve`) runs a case as a short series of steps; everything that happens
streams to the browser over Server-Sent Events.

```
POST /api/cases                         {expert?}            → the case
POST /api/cases/:id/photos              multipart            → the photos, in upload order
POST /api/cases/:id/read                                     → 202; events: read_progress, status "read"
POST /api/cases/:id/confirm             {fire_date, place, numbers[], notes}  → status "ready"
POST /api/cases/:id/messages            {text?}              → 202; events: text, tool, approval, turn_end
POST /api/cases/:id/approvals/:aid      {allow}              → the expert's answer to an outward action
GET  /api/cases/:id/events              SSE (Last-Event-ID / ?after=N replays what was missed)
GET  /api/cases/:id/files/:name         the .docx / .xlsx
GET  /api/cases, /api/cases/:id, /api/health
```

- **Confirm first, then write.** The date, the place and every handwritten number are checked on
  one screen before the agent starts, and go into its first message – so the agent writes the whole
  report in one turn without stopping to ask (a pause past the prompt cache's lifetime would cost a
  new cache write).
- **One turn per message, resumable.** Each message runs one agent turn and saves the SDK session
  id; the next message resumes it. A restart mid-turn leaves the case `interrupted`, never stuck.
- **Approvals over HTTP.** When the agent wants to send an e-mail or save a template, the server
  emits an `approval` event and waits for the expert's answer (refused after 15 minutes).
- **Budget per case**, across turns: reading and writing are counted together; a case over
  `CASE_BUDGET_USD` takes no more messages.
- `APP_TOKEN` guards every `/api` route (bearer header, or `?token=` for `EventSource`); without it
  the server refuses to listen beyond localhost. The photos are kept outside the agent's folder.

A real case through the API: 11 photos read in 26 s for $0.013, the report and the fee sheet
written in 2 min 50 s for $0.49 – $0.50 for the case.

## Keeping up with the skill

The methodology lives in the fire-service plugin, which keeps improving. Every hour the
`sync-plugin` workflow checks the plugin's main branch; when it moved, it vendors the new commit,
runs the type check, the tests and `npm run check:plugin` (the agent starts and must load the plugin
at the pinned version with the eptz skill), and commits the new `plugin.lock`. A plugin change that
would break the app fails there and never reaches it. `npm run vendor:plugin` brings a running copy
to the pinned commit.

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
- **Fewer, cheaper turns for the writer.** Before the agent starts, the app runs the skill's first
  command (rules, terms, the incident record, METAR, the expert's details) and puts the result in
  its first message; the skill files it reads in every case are in the cached system prompt. On the
  same case: 25 → 14 model calls, 1.75 M → 0.56 M cache-read tokens, $0.93 → $0.54.
- `PROMPT_CACHE_TTL` (5m by default; 1h for cases with long pauses). Without the cache the same
  case would cost about $2.

## Run it

Requirements: Node 22+, Python 3 with `python-docx` and `openpyxl`, and on Linux `bubblewrap` and
`socat` for the sandbox.

```sh
npm install
npm run vendor:plugin           # fetches the fire-service plugin at the pinned commit
cp .env.example .env            # add ANTHROPIC_API_KEY (and FIRE_SERVICE_KEY, if you have one)
npm run case -- ./cases/my-case # in the terminal: a folder of JPEG/PNG/WebP photos
npm run serve                   # or the web server on http://127.0.0.1:8787
npm test
```

## Plan

0. Agent in the terminal: reader, writer, sandbox, approvals, cost log.
1. Server: Fastify, a case API, SSE streaming of the agent's text and steps. ← here
2. React + TypeScript PWA: upload from the camera with progress, confirm handwritten numbers,
   approve actions, download the documents.
3. Compaction: a `PreCompact` hook keeps a case dossier so the agent never asks twice.
4. Production basics: retries and fallbacks end to end, per-case budget in the UI, metrics page.
5. Evals in CI: reading accuracy on a fixed set of pages, report checks, a regression threshold.
6. Public demo on an invented case, and a case study with real numbers.

## License

All rights reserved for now; a license will be added before the public demo.
