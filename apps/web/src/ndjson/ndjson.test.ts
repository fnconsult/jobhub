import { describe, expect, it, vi } from "vitest";
import type { ProvenanceEvent } from "@jobhub/shared";
import { actionResponse, NDJSON_TYPE, ndjsonResponse, readNdjson, STOPPED, type ActionOutcome } from "./index";

const stream = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

describe("a streamed action's response (#328)", () => {
  it("sends each event as one JSON line as it happens, then ends", async () => {
    const response = ndjsonResponse(new AbortController().signal, async (send) => {
      send({ type: "step_started", id: 1 });
      await new Promise((resolve) => setTimeout(resolve, 5));
      send({ type: "reply", reply: "Bonjour\nMarie" });
    });
    const events: unknown[] = [];

    expect(response.headers.get("content-type")).toBe(NDJSON_TYPE);
    await readNdjson(response.body!, (event) => events.push(event));

    expect(events).toEqual([
      { type: "step_started", id: 1 },
      { type: "reply", reply: "Bonjour\nMarie" },
    ]);
  });

  it("stops the action when the reader stops reading", async () => {
    let signal: AbortSignal | undefined;
    const response = ndjsonResponse(new AbortController().signal, (send, stop) => {
      signal = stop;
      send({ type: "step_started", id: 1 });
      return new Promise<void>((resolve) => stop.addEventListener("abort", () => resolve()));
    });
    const reader = response.body!.getReader();
    await reader.read();

    await reader.cancel();

    expect(signal?.aborted).toBe(true);
  });

  it("stops the action when the request is aborted, and sends nothing after", async () => {
    const request = new AbortController();
    let signal: AbortSignal | undefined;
    const response = ndjsonResponse(request.signal, async (send, stop) => {
      signal = stop;
      await new Promise((resolve) => stop.addEventListener("abort", resolve));
      send({ type: "late" });
    });
    const events: unknown[] = [];
    const reading = readNdjson(response.body!, (event) => events.push(event));

    request.abort();
    await reading;

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual([]);
  });

  it("ends the stream when the action throws, after what it sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = ndjsonResponse(new AbortController().signal, async (send) => {
      send({ type: "step_started", id: 1 });
      throw new Error("down");
    });
    const events: unknown[] = [];

    await readNdjson(response.body!, (event) => events.push(event));

    expect(events).toEqual([{ type: "step_started", id: 1 }]);
    error.mockRestore();
  });
});

describe("reading a streamed response", () => {
  it("reads lines cut across chunks, and a last line without its line break", async () => {
    const events: unknown[] = [];

    await readNdjson(stream('{"a":', '1}\n{"b"', ':2}\n\n{"c":3}'), (event) => events.push(event));

    expect(events).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

describe("an AI action's route, streamed when asked for (#334)", () => {
  const at = new Date().toISOString();
  const started: ProvenanceEvent = { type: "step_started", id: 1, step: { kind: "ai", activity: "write", task: "writing", at } };
  const ended: ProvenanceEvent = { type: "step_ended", id: 1, step: { kind: "ai", activity: "write", task: "writing", at, ms: 12, outcome: "ok", count: 1 } };
  const post = (accept?: string) => new Request("http://localhost/api/action", { method: "POST", ...(accept ? { headers: { accept } } : {}) });

  /** An action that tells one step, then ends with `outcome`. */
  const action = (outcome: ActionOutcome) => async ({ onEvent }: { signal: AbortSignal; onEvent?: (event: ProvenanceEvent) => void }) => {
    onEvent?.(started);
    onEvent?.(ended);
    return outcome;
  };

  async function eventsOf(response: Response) {
    const events: unknown[] = [];
    await readNdjson(response.body!, (event) => events.push(event));
    return events;
  }

  it("answers JSON with the outcome's status when the client does not ask for NDJSON", async () => {
    const response = await actionResponse(post(), action({ status: 503, body: { error: "unavailable" } }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("streams each step as it starts, with its label, and ends, then what it made", async () => {
    const response = await actionResponse(post("application/x-ndjson"), action({ status: 200, body: { drafts: 1 } }));

    expect(response.headers.get("content-type")).toBe(NDJSON_TYPE);
    expect(await eventsOf(response)).toEqual([{ ...started, label: "write" }, ended, { type: "done", drafts: 1 }]);
  });

  it("ends with its stop, or its failure and status", async () => {
    const stopped = await actionResponse(post("application/x-ndjson"), action({ status: STOPPED, body: { error: "stopped" } }));
    const failed = await actionResponse(post("application/x-ndjson"), action({ status: 503, body: { error: "unavailable" } }));

    expect((await eventsOf(stopped)).at(-1)).toEqual({ type: "stopped", error: "stopped" });
    expect((await eventsOf(failed)).at(-1)).toEqual({ type: "failed", status: 503, error: "unavailable" });
  });

  it("ends an action that throws with its failure: 500 and its Failure Reason, never the error's words (#367)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = (thrown: Error) => async ({ onEvent }: { signal: AbortSignal; onEvent?: (event: ProvenanceEvent) => void }): Promise<ActionOutcome> => {
      onEvent?.(started);
      throw thrown;
    };
    const rateLimited = Object.assign(new Error("perplexity: 429 slow down, Marie Dupont"), { name: "AiProviderError", status: 429 });

    const streamed = await actionResponse(post("application/x-ndjson"), throwing(rateLimited));
    const answered = await actionResponse(post(), throwing(rateLimited));
    const unknown = await actionResponse(post("application/x-ndjson"), throwing(new Error("disk full")));

    expect(await eventsOf(streamed)).toEqual([{ ...started, label: "write" }, { type: "failed", status: 500, error: "failed", reason: "rate_limited" }]);
    expect(answered.status).toBe(500);
    expect(await answered.json()).toEqual({ error: "failed", reason: "rate_limited" });
    expect((await eventsOf(unknown)).at(-1)).toEqual({ type: "failed", status: 500, error: "failed", reason: "other" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("Marie Dupont");
    error.mockRestore();
  });

  it("hands the action the request's abort: the Stop", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const request = new Request("http://localhost/api/action", { method: "POST", headers: { accept: "application/x-ndjson" }, signal: controller.signal });
    const response = await actionResponse(request, (live) => {
      signal = live.signal;
      return new Promise((resolve) => live.signal.addEventListener("abort", () => resolve({ status: STOPPED, body: { error: "stopped" } })));
    });
    const reading = eventsOf(response);

    controller.abort();
    await reading;

    expect(signal?.aborted).toBe(true);
  });
});
