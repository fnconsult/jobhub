/**
 * Streamed actions (#319 §4, #328): an action that runs in the request sends its events as it goes, one JSON object
 * per line (NDJSON) on its own POST, and the person's Stop is the request's abort. Web streams only, so the browser
 * reads with the same module.
 *
 *   return ndjsonResponse(request.signal, async (send, signal) => { ... send(event) ... });   // a route
 *   return actionResponse(request, ({ signal, onEvent }) => run(...));                        // an AI action's route
 *   await readNdjson(response.body, (event) => ...);                                           // the page
 *
 * The action's `signal` aborts when the request is aborted or the reader stops reading; nothing it sends after
 * that goes out. An action that throws ends the stream after what it sent, logged without its content.
 */
import { failureOf, stepLabel, type ProvenanceEvent } from "@jobhub/shared";

export const NDJSON_TYPE = "application/x-ndjson; charset=utf-8";

/** 499: the person stopped the action, as proxies log a request its client closed. */
export const STOPPED = 499;

/** How an AI action ended, as its route answers: its HTTP status (`STOPPED` for a Stop) and JSON body. */
export interface ActionOutcome {
  status: number;
  body: object;
}

/**
 * An AI action's route (#334, ADR-0034): with `Accept: application/x-ndjson`, 200 and one event per line as it runs,
 *   { type: "step_started", id, step, label }   a step starts: its Activity and what AI Activity calls it (`stepLabel`)
 *   { type: "step_ended", id, step }            it ends: its model, tokens, time and Outcome
 * then { type: "done", ...body } · { type: "stopped", ...body } · { type: "failed", status, ...body }; otherwise its body as
 * JSON with its status. Either way the request's abort is the Stop, handed to `run` as `signal`. A `run` that throws ends
 * with 500 { error: "failed", reason }: its Failure Reason (#367), logged by its error's name, never its message.
 */
export async function actionResponse(
  request: Request,
  run: (live: { signal: AbortSignal; onEvent?: (event: ProvenanceEvent) => void }) => Promise<ActionOutcome>,
): Promise<Response> {
  const outcomeOf = async (live: Parameters<typeof run>[0]): Promise<ActionOutcome> => {
    try {
      return await run(live);
    } catch (error) {
      console.error("[ndjson] an AI action failed:", error instanceof Error ? error.name : "unknown");
      return { status: 500, body: { error: "failed", reason: failureOf(error).reason } };
    }
  };
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    const { status, body } = await outcomeOf({ signal: request.signal });
    return Response.json(body, { status });
  }
  return ndjsonResponse(request.signal, async (send, signal) => {
    const { status, body } = await outcomeOf({ signal, onEvent: (event) => send(event.type === "step_started" ? { ...event, label: stepLabel(event.step) } : event) });
    send(status < 300 ? { type: "done", ...body } : status === STOPPED ? { type: "stopped", ...body } : { type: "failed", status, ...body });
  });
}

export function ndjsonResponse(requestSignal: AbortSignal, run: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancelled.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // Already cancelled by the reader.
        }
      };
      signal.addEventListener("abort", close, { once: true });
      const send = (event: unknown) => {
        if (open && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      run(send, signal)
        .catch((error: unknown) => console.error("[ndjson] a streamed action failed:", error instanceof Error ? error.name : "unknown"))
        .finally(close);
    },
    cancel() {
      cancelled.abort();
    },
  });
  // No buffering on the way (a proxy holding the lines back would show the steps all at once).
  return new Response(body, { headers: { "content-type": NDJSON_TYPE, "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

/** Reads a streamed response to its end, each line's event to `onEvent`; a blank line is skipped. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const flush = (lines: string[]) => {
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = (pending + decoder.decode(value, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    flush(lines);
  }
  flush([pending + decoder.decode()]);
}
