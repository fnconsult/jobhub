import { createApi } from "../api/web-api";
import { askCoach, type Live } from "./coach-reply";
import { aiStep, replyEvent, streamedReply, type StreamedReply } from "./testing";

/** The web app's `POST /api/coach`, answering with `stream`; what the app sent is `sent`. */
function coachRoute(answer: (init: RequestInit) => Response | Promise<Response>) {
  const sent: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const api = createApi({
    baseURL: "https://staging.jobbbox.ai",
    cookie: async () => "session=1",
    fetch: async (url, init = {}) => {
      sent.push({ url, init, body: JSON.parse(String(init.body)) });
      return answer(init);
    },
  });
  return { api, sent };
}

/** Lets the stream's reads run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reading the Coach's reply from its NDJSON stream", () => {
  let stream: StreamedReply;
  beforeEach(() => (stream = streamedReply()));

  it("asks for the stream, with the message and where it goes", async () => {
    const { api, sent } = coachRoute((init) => stream.respond(init));
    const asked = askCoach(api, { conversationId: "c1", message: "Bonjour", route: "/conversations/c1", helpArticle: { id: "faq", title: "Quand ?" } });
    stream.send(replyEvent("Bonjour !"));
    stream.end();
    await asked;

    expect(sent[0]!.url).toBe("https://staging.jobbbox.ai/api/coach");
    expect(sent[0]!.init.method).toBe("POST");
    expect(new Headers(sent[0]!.init.headers).get("accept")).toBe("application/x-ndjson");
    expect(sent[0]!.body).toEqual({ conversationId: "c1", message: "Bonjour", route: "/conversations/c1", helpArticle: { id: "faq", title: "Quand ?" } });
  });

  it("follows the events as they come, whole or cut anywhere in a chunk, and gives the reply at the end", async () => {
    const { api } = coachRoute((init) => stream.respond(init));
    const lives: Live[] = [];
    const asked = askCoach(api, { message: "Prépare-moi" }, { onLive: (live) => lives.push(live) });

    const step = aiStep(1);
    // Two events in one chunk, the second cut in the middle of its line.
    const first = `${JSON.stringify({ type: "conversation", conversation: { id: "c1", title: "Préparer", lastMessageAt: "2026-11-05T10:00:00.000Z" } })}\n`;
    const second = `${JSON.stringify(step.started)}\n`;
    stream.write(first + second.slice(0, 20));
    await settle();
    expect(lives).toEqual([]);
    stream.write(second.slice(20));
    await settle();
    expect(lives.at(-1)).toEqual({ step: { activity: "think", label: "think" }, tokens: 0 });

    stream.send(step.ended);
    await settle();
    expect(lives.at(-1)).toEqual({ step: { activity: "think", label: "think" }, tokens: 1200 });

    // The reply's last line, its « é » split between two chunks, and no newline before the stream ends.
    const bytes = new TextEncoder().encode(JSON.stringify(replyEvent("Très bien, préparons-le.")));
    const middle = bytes.indexOf(0xc3) + 1;
    stream.write(bytes.slice(0, middle));
    stream.write(bytes.slice(middle));
    stream.end();

    const outcome = await asked;
    expect(outcome).toMatchObject({ kind: "reply", reply: { reply: "Très bien, préparons-le.", conversation: { id: "c1" }, context: { messages: 2, tokens: 1500 } } });
  });

  it("is stopped by « Arrêter »: the request is aborted, the question stays in the conversation the server named", async () => {
    const { api, sent } = coachRoute((init) => stream.respond(init));
    const stop = new AbortController();
    const asked = askCoach(api, { message: "Une longue question" }, { signal: stop.signal });
    stream.send({ type: "conversation", conversation: { id: "c9", title: "Une longue question", lastMessageAt: "2026-11-05T10:00:00.000Z" } });
    stream.send(aiStep(1).started);
    stream.send(aiStep(1, { input: 400, output: 100 }).ended);
    await settle();

    stop.abort();

    const outcome = await asked;
    expect(sent[0]!.init.signal?.aborted).toBe(true);
    expect(outcome).toMatchObject({ kind: "stopped", conversation: { id: "c9" }, spent: { tokens: 500 } });
  });

  it("says the server stopped the reply, with the conversation's Context bar once saved", async () => {
    const { api } = coachRoute((init) => stream.respond(init));
    const asked = askCoach(api, { message: "Bonjour" });
    stream.send({ type: "stopped", conversation: { id: "c2", title: "Bonjour", lastMessageAt: "2026-11-05T10:00:00.000Z" }, context: { messages: 1, tokens: 300 } });
    stream.end();
    await expect(asked).resolves.toMatchObject({ kind: "stopped", conversation: { id: "c2" }, context: { messages: 1, tokens: 300 } });
  });

  it("gives the failure's Failure Reason, as the web says it, never the technical message", async () => {
    const { api } = coachRoute((init) => stream.respond(init));
    const asked = askCoach(api, { message: "Bonjour" });
    stream.send(aiStep(1).started);
    stream.send({ type: "failed", error: "unavailable", reason: "provider_unavailable" });
    stream.end();
    await expect(asked).resolves.toEqual({ kind: "failed", reason: "provider_unavailable" });
  });

  it("fails without a reason it does not know", async () => {
    const { api } = coachRoute((init) => stream.respond(init));
    const asked = askCoach(api, { message: "Bonjour" });
    stream.send({ type: "failed", error: "unavailable", reason: "Error: socket hang up at 10.0.0.3" });
    stream.end();
    await expect(asked).resolves.toEqual({ kind: "failed", reason: null });
  });

  it("tells a message refused as invalid, and a conversation gone meanwhile", async () => {
    const invalid = streamedReply();
    const gone = streamedReply();
    const answers = [invalid, gone];
    const { api } = coachRoute((init) => answers.shift()!.respond(init));
    const first = askCoach(api, { message: "x".repeat(6000) });
    invalid.send({ type: "failed", error: "invalid" });
    invalid.end();
    await expect(first).resolves.toEqual({ kind: "invalid" });

    const second = askCoach(api, { conversationId: "deleted", message: "Bonjour" });
    gone.send({ type: "failed", error: "not_found" });
    gone.end();
    await expect(second).resolves.toEqual({ kind: "gone" });
  });

  it("fails when the stream is cut short, before its last event", async () => {
    const { api } = coachRoute((init) => stream.respond(init));
    const asked = askCoach(api, { message: "Bonjour" });
    stream.send(aiStep(1).started);
    stream.write('{"type":"reply","reply":"Bonj');
    stream.end();
    await expect(asked).resolves.toEqual({ kind: "failed", reason: null });
  });

  it("fails when the web app cannot be reached, or answers without a stream", async () => {
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError("Network request failed")),
      async () => Response.json({ error: "unavailable", reason: "rate_limited" }, { status: 503 }),
      async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    ];
    const { api } = coachRoute(() => answers.shift()!());
    await expect(askCoach(api, { message: "Bonjour" })).resolves.toEqual({ kind: "failed", reason: null });
    await expect(askCoach(api, { message: "Bonjour" })).resolves.toEqual({ kind: "failed", reason: "rate_limited" });
    await expect(askCoach(api, { message: "Bonjour" })).resolves.toEqual({ kind: "failed", reason: null });
  });
});
