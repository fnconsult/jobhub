import { createApi } from "../api/web-api";

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
  started: { type: "step_started", id, step: { kind: "ai", activity: "think", task: "coach_reply" }, label: "think" },
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

type SavedMessage = { from: "candidate" | "coach"; text: string; at?: string; provenance?: null; cards?: unknown[] };
type Saved = {
  id: string;
  title: string;
  subject: { kind: string; id: string; name: string } | null;
  profile: null;
  lastMessageAt: string;
  aiDisclosure: boolean;
  messages: SavedMessage[];
  context: { messages: number; tokens: number };
};

const AT = "2026-11-05T10:00:00.000Z";

/**
 * The web app's routes a Coach Conversation calls, as they answer (apps/web/src/app/api/coach): `POST /api/coach`
 * streaming each reply as the test writes it (`pending()`, or `reply()` for a whole one, saved as the server saves it),
 * the conversations' reads, rename and delete, `POST /api/signalements`, and any other GET from `reads` by its path.
 * `asked` is every message sent, `signalements` every Signalement.
 */
export function fakeCoachWeb({
  conversations = [],
  reads = {},
}: { conversations?: { id: string; title: string; subject?: Saved["subject"]; messages?: SavedMessage[] }[]; reads?: Record<string, unknown> } = {}) {
  const saved = new Map<string, Saved>(
    conversations.map((each) => [
      each.id,
      {
        id: each.id,
        title: each.title,
        subject: each.subject ?? null,
        profile: null,
        lastMessageAt: AT,
        aiDisclosure: true,
        messages: each.messages ?? [],
        context: { messages: each.messages?.length ?? 0, tokens: 400 },
      },
    ]),
  );
  const streams: { stream: StreamedReply; body: Record<string, unknown> }[] = [];
  const asked: Record<string, unknown>[] = [];
  const signalements: Record<string, unknown>[] = [];
  const requests: { method: string; path: string; body: unknown }[] = [];
  let next = 0;
  let offline = false;

  const summary = ({ id, title, subject, profile, lastMessageAt }: Saved) => ({ id, title, subject, profile, lastMessageAt });
  /** The conversation a message goes to, as the server picks it: the one named, the Subject's, or a new one named after it. */
  const conversationFor = (body: Record<string, unknown>): Saved => {
    const named = typeof body.conversationId === "string" ? saved.get(body.conversationId) : undefined;
    if (named) return named;
    const subject = body.subject as { kind: string; id: string } | undefined;
    const ofSubject = subject && [...saved.values()].find((each) => each.subject?.kind === subject.kind && each.subject.id === subject.id);
    if (ofSubject) return ofSubject;
    const id = `c${++next}`;
    const created: Saved = {
      id,
      title: String(body.message).slice(0, 40),
      subject: subject ? { ...subject, name: subject.id } : null,
      profile: null,
      lastMessageAt: AT,
      aiDisclosure: true,
      messages: [],
      context: { messages: 0, tokens: 0 },
    };
    saved.set(id, created);
    return created;
  };

  async function fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (offline) throw new TypeError("Network request failed");
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ method, path: `${pathname}${searchParams.size ? `?${searchParams}` : ""}`, body });
    if (pathname === "/api/coach" && method === "POST") {
      asked.push(body!);
      const stream = streamedReply();
      streams.push({ stream, body: body! });
      return stream.respond(init);
    }
    if (pathname === "/api/coach/conversations" && method === "GET") {
      const kind = searchParams.get("kind");
      if (kind) {
        const found = [...saved.values()].find((each) => each.subject?.kind === kind && each.subject.id === searchParams.get("id"));
        return Response.json({ conversation: found ?? null });
      }
      const list = [...saved.values()].filter((each) => searchParams.get("free") !== "1" || each.subject === null);
      return Response.json({ conversations: list.map(summary) });
    }
    const one = /^\/api\/coach\/conversations\/([^/]+)$/.exec(pathname);
    if (one) {
      const found = saved.get(decodeURIComponent(one[1]!));
      if (!found) return Response.json({ error: "not_found" }, { status: 404 });
      if (method === "GET") return Response.json({ conversation: found });
      if (method === "PATCH") {
        const title = String(body?.title ?? "").trim();
        if (!title) return Response.json({ error: "invalid" }, { status: 400 });
        found.title = title;
        return Response.json({ conversation: summary(found) });
      }
      if (method === "DELETE") {
        saved.delete(found.id);
        return new Response(null, { status: 204 });
      }
    }
    if (pathname === "/api/signalements" && method === "POST") {
      signalements.push(body!);
      return Response.json({ signalement: { id: `s${signalements.length}` } }, { status: 201 });
    }
    if (method === "GET" && pathname in reads) return Response.json(reads[pathname]);
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const pending = () => {
    const last = streams.at(-1);
    if (!last) throw new Error("No message was sent to the coach");
    return last;
  };

  return {
    api: createApi({ baseURL: "https://staging.jobbbox.ai", cookie: async () => "__Secure-better-auth.session_token=s1.sig", fetch }),
    fetch,
    asked,
    signalements,
    requests,
    saved,
    /** The other GETs' answers, by path (the menus' cards): a test sets them. */
    reads,
    /** The reply on its way to the last message, to write a piece at a time. */
    pending: () => pending().stream,
    /** The conversation the last message goes to, named as the stream names it first. */
    named() {
      const { stream, body } = pending();
      const conversation = conversationFor(body);
      stream.send({ type: "conversation", conversation: summary(conversation) });
      return conversation;
    },
    /** Answers the last message whole: its conversation, a step, the reply, saved with the question as the server saves them. */
    reply(text: string, more: object = {}) {
      const { stream, body } = pending();
      const conversation = conversationFor(body);
      conversation.messages.push({ from: "candidate", text: String(body.message) }, { from: "coach", text, at: AT, provenance: null });
      conversation.context = { messages: conversation.messages.length, tokens: 1500 };
      const step = aiStep(1);
      stream.send({ type: "conversation", conversation: summary(conversation) });
      stream.send(step.started);
      stream.send(step.ended);
      stream.send(replyEvent(text, { conversation: summary(conversation), context: conversation.context, ...more }));
      stream.end();
    },
    /** The reply fails, for `reason`. */
    fail(reason: string | null = "provider_unavailable", error = "unavailable") {
      const { stream } = pending();
      stream.send({ type: "failed", error, ...(reason ? { reason } : {}) });
      stream.end();
    },
    setOffline: (value: boolean) => void (offline = value),
  };
}

export type FakeCoachWeb = ReturnType<typeof fakeCoachWeb>;
