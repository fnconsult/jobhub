import { describe, expect, it, vi } from "vitest";
import { NDJSON_TYPE, ndjsonResponse, readNdjson } from "./index";

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
