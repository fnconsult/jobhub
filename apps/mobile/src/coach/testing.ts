/**
 * The web app's `POST /api/coach` as a test drives it (apps/web/src/app/api/coach/route.ts): a reply streamed one JSON
 * event per line, written by the test a piece at a time, cut wherever it likes, and whose request's abort errors the
 * stream as a native fetch does.
 */
export function streamedReply() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start: (opened) => void (controller = opened) });
  return {
    /** The answer to the request `init`: 200, NDJSON; aborting the request errors its body. */
    respond(init?: RequestInit): Response {
      init?.signal?.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
    },
    /** Raw text or bytes, cut anywhere, a line in the middle included. */
    write(piece: string | Uint8Array) {
      if (!closed) controller.enqueue(typeof piece === "string" ? encoder.encode(piece) : piece);
    },
    /** One whole event, on its line. */
    send(event: object) {
      this.write(`${JSON.stringify(event)}\n`);
    },
    /** The server ends the stream. */
    end() {
      if (closed) return;
      closed = true;
      controller.close();
    },
  };
}

export type StreamedReply = ReturnType<typeof streamedReply>;

/** A step's events as the route streams them: an AI call to the model, its tokens once it ends. */
export const aiStep = (id: number, tokens = { input: 900, output: 300 }) => ({
  started: { type: "step_started", id, step: { kind: "ai", activity: "think", task: "coach_reply" }, label: "thinking" },
  ended: { type: "step_ended", id, step: { kind: "ai", activity: "think", task: "coach_reply", model: "m", provider: "p", tokens, ms: 1200, outcome: "ok" } },
});

/** The 200 body of a reply, as the route sends it last (`{ type: "reply", ... }`). */
export const replyEvent = (reply: string, more: object = {}) => ({
  type: "reply",
  conversation: { id: "c1", title: "Préparer un entretien", lastMessageAt: "2026-11-05T10:00:00.000Z" },
  reply,
  blocked: { message: false, reply: false },
  provenance: null,
  at: "2026-11-05T10:00:00.000Z",
  couldNotAnswer: false,
  context: { messages: 2, tokens: 1500 },
  ...more,
});
