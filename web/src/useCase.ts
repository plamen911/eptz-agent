import { useCallback, useEffect, useRef, useState } from "react";
import { applyProgress, emptyProgress } from "../../server/src/cases/progress.js";
import { api } from "./api";
import type { CaseEvent, CaseView, Progress } from "./types";

const EVENT_TYPES: CaseEvent["type"][] = ["status", "read_progress", "text", "tool", "approval", "approval_resolved", "turn_end", "cost"];

/** Statuses after which the case on the server has changed beyond the events – fetch it again. */
const SETTLED = new Set(["read", "ready", "error", "interrupted"]);

/**
 * One case, live: the state from the server and the work in progress from its event stream.
 * EventSource reconnects by itself and sends Last-Event-ID, so a phone that loses the network
 * picks up where it stopped.
 */
export function useCase(id: string) {
  const [view, setView] = useState<CaseView | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress());
  const [error, setError] = useState<Error | null>(null);
  const [online, setOnline] = useState(true);
  const source = useRef<EventSource | null>(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.get(id);
      setView(fresh);
      setError(null);
      return fresh;
    } catch (e) {
      setError(e as Error);
      return null;
    }
  }, [id]);

  useEffect(() => {
    let closed = false;
    void (async () => {
      const first = await reload();
      if (!first || closed) return;
      setProgress(first.progress ?? emptyProgress());
      const es = new EventSource(api.eventsUrl(id, first.lastEventId));
      source.current = es;
      es.onopen = () => setOnline(true);
      es.onerror = () => setOnline(false);
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (message) => {
          const event = JSON.parse((message as MessageEvent<string>).data) as CaseEvent;
          setProgress((p) => applyProgress(p, event));
          if (event.type === "status") {
            setView((v) => (v ? { ...v, status: event.status as CaseView["status"], ...(event.error ? { error: event.error } : {}) } : v));
            if (SETTLED.has(event.status)) void reload();
          } else if (event.type === "cost") {
            setView((v) => (v ? { ...v, costUsd: event.caseCostUsd } : v));
          } else if (event.type === "turn_end") {
            setView((v) => (v ? { ...v, costUsd: event.caseCostUsd, files: event.files } : v));
          }
        });
      }
    })();
    return () => {
      closed = true;
      source.current?.close();
      source.current = null;
    };
  }, [id, reload]);

  return { view, setView, progress, error, online, reload };
}
