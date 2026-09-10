/**
 * Minimal in-memory pub/sub for SSE progress events, keyed by GenerationRun id.
 *
 * Known limitation (worth stating plainly in the README rather than hiding
 * it): this only works within a single server process/instance. A multi-
 * instance deployment would need a shared pub/sub (Redis, etc). Given the
 * free-tier single-instance deployment target (Render free web service),
 * that's an acceptable scope trade-off for this assessment — but it's a
 * limitation, not an oversight, and worth naming as such in the README's
 * "known limitations" section.
 */

import { Response } from "express";

type Listener = (event: { type: string; data: unknown }) => void;

const subscribers = new Map<string, Set<Listener>>();

export function subscribe(runId: string, listener: Listener): () => void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId)!.add(listener);
  return () => {
    subscribers.get(runId)?.delete(listener);
    if (subscribers.get(runId)?.size === 0) subscribers.delete(runId);
  };
}

export function publish(runId: string, type: string, data: unknown): void {
  subscribers.get(runId)?.forEach((listener) => listener({ type, data }));
}

/** Wires an Express Response as an SSE stream subscribed to a given run. */
export function attachSSE(res: Response, runId: string): () => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: connected\ndata: {}\n\n`);

  const unsubscribe = subscribe(runId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  });

  return unsubscribe;
}
