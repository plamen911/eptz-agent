import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Numbered } from "../cases/events.js";
import { type CaseManager, HttpError } from "../cases/manager.js";
import { type CaseState, caseCost, Confirmation } from "../cases/state.js";

export interface AppOptions {
  manager: CaseManager;
  /** required on every /api request when set */
  token?: string;
  /** what /api/health reports */
  plugin: { version: string; ref: string };
  logger?: boolean;
  /** SSE keep-alive, so proxies and phones do not drop a quiet stream */
  heartbeatMs?: number;
}

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTOS = 80;

/**
 * What the client gets for a case: the state, the derived total and the number of the last event –
 * a client that opens the stream with ?after=lastEventId gets only what happens from then on.
 */
const view = (s: CaseState, lastEventId = 0) => ({ ...s, costUsd: caseCost(s), lastEventId });

const CreateBody = z.object({ expert: z.string().max(100).optional() }).default({});
const MessageBody = z.object({ text: z.string().max(20_000).optional() }).default({});
const ApprovalBody = z.object({ allow: z.boolean() });
const Params = z.object({ id: z.string() });

function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // EventSource cannot set headers – the stream takes the token in the query instead
  const query = request.query as Record<string, unknown>;
  return typeof query.token === "string" ? query.token : undefined;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { manager } = options;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS } });

  app.addHook("onRequest", async (request, reply) => {
    if (!options.token || !request.url.startsWith("/api/") || request.url === "/api/health") return;
    if (!sameToken(bearer(request), options.token)) return reply.code(401).send({ error: "Unauthorized" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }
    const e = error as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    request.log.error(error);
    return reply.code(500).send({ error: "Internal error" });
  });

  app.get("/api/health", async () => ({ ok: true, plugin: options.plugin }));

  app.get("/api/cases", async () => (await manager.list()).map(view));

  app.post("/api/cases", async (request, reply) => {
    const body = CreateBody.parse(request.body ?? {});
    return reply.code(201).send(view(await manager.create(body.expert)));
  });

  app.get("/api/cases/:id", async (request) => {
    const { id } = Params.parse(request.params);
    const live = await manager.get(id);
    return view(live.state, live.events.lastId);
  });

  app.post("/api/cases/:id/photos", async (request) => {
    const { id } = Params.parse(request.params);
    if (!request.isMultipart()) throw new HttpError(415, "Send the photos as multipart/form-data");
    const saved: string[] = [];
    for await (const part of request.files()) {
      saved.push(await manager.addPhoto(id, part.filename, part.file));
      if (part.file.truncated) throw new HttpError(413, `${part.filename} is larger than ${MAX_PHOTO_BYTES >> 20} MB`);
    }
    return { saved, photos: (await manager.get(id)).state.photos };
  });

  app.post("/api/cases/:id/read", async (request, reply) => {
    const { id } = Params.parse(request.params);
    await manager.read(id);
    return reply.code(202).send({ status: "reading" });
  });

  app.post("/api/cases/:id/confirm", async (request) => {
    const { id } = Params.parse(request.params);
    return view(await manager.confirm(id, Confirmation.parse(request.body)));
  });

  app.post("/api/cases/:id/messages", async (request, reply) => {
    const { id } = Params.parse(request.params);
    const body = MessageBody.parse(request.body ?? {});
    await manager.send(id, body.text);
    return reply.code(202).send({ status: "writing" });
  });

  app.post("/api/cases/:id/approvals/:approvalId", async (request, reply) => {
    const { id, approvalId } = z.object({ id: z.string(), approvalId: z.string() }).parse(request.params);
    await manager.resolveApproval(id, approvalId, ApprovalBody.parse(request.body).allow);
    return reply.code(204).send();
  });

  app.get("/api/cases/:id/files/:name", async (request, reply) => {
    const { id, name } = z.object({ id: z.string(), name: z.string() }).parse(request.params);
    const path = await manager.file(id, name);
    const type = name.endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : name.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf";
    return reply
      .type(type)
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(createReadStream(path));
  });

  /**
   * The case as it happens: Server-Sent Events. A client that reconnects sends Last-Event-ID (the
   * browser does it by itself) or ?after=N and first gets the events it missed.
   */
  app.get("/api/cases/:id/events", async (request, reply) => {
    const { id } = Params.parse(request.params);
    const live = await manager.get(id);
    const query = request.query as Record<string, unknown>;
    const after = Number(request.headers["last-event-id"] ?? query.after ?? 0) || 0;

    reply.hijack();
    const out = reply.raw;
    out.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: do not hold the stream back
    });
    out.write("retry: 3000\n\n");
    const send = ({ id: n, event }: Numbered) => out.write(`id: ${n}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    // the current state first, so a fresh client can draw the page before any event arrives
    out.write(`event: snapshot\ndata: ${JSON.stringify(view(live.state, live.events.lastId))}\n\n`);
    const unsubscribe = live.events.subscribe(after, send);
    const heartbeat = setInterval(() => out.write(": ping\n\n"), options.heartbeatMs ?? 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}
