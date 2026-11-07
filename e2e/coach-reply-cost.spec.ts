import path from "node:path";
import { expect, test, type APIRequestContext, type Playwright } from "@playwright/test";
import pg from "pg";
import { emailsIn, linkIn, newAddress } from "./support/mailbox";
import { startOwnServer, type OwnServer } from "./support/own-server";

// Issue #805 (ADR-0086): each AI Coach reply loaded on a page carries its ReplyCost (`sent`: calls, turns, rounds, inputTokens,
// cachedInputTokens, outputTokens), the sum of all its AI calls as #791 keeps it on coach_message, or null for a reply saved
// before #791. Nothing new is shown: the spec drives the public HTTP entry points (POST /api/coach, GET /api/coach/conversations/[id]).
// The AI Coach is faked inside the server (fake-mistral.mjs): each
// `E2E_COACH_TOOL=<name>:<json>` of a message has it call that Coach Action in turn, so a reply with two of them has 2 Tool rounds;
// the Guardrails' checks run on the same fake.
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 805;

type ReplyCost = { calls: number; turns: number; rounds: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };
type Message = { from: "candidate" | "coach"; text: string; sent?: ReplyCost | null };

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** A new Candidate signed in over HTTP, by magic link (no browser: every entry point here is the HTTP API). */
async function signedIn(playwright: Playwright, label: string): Promise<APIRequestContext> {
  const email = newAddress(label);
  const api = await playwright.request.newContext({ baseURL: server.origin, extraHTTPHeaders: { origin: server.origin } });
  const sent = await api.post("/api/auth/sign-in/magic-link", { data: { email, callbackURL: "/" } });
  expect(sent.ok(), await sent.text()).toBe(true);
  await expect.poll(() => emailsIn(server.output(), email).length, { message: `sign-in email to ${email}` }).toBeGreaterThan(0);
  const verified = await api.get(linkIn(emailsIn(server.output(), email)[0]!), { maxRedirects: 5 });
  expect(verified.ok(), `the magic link answered ${verified.status()}`).toBe(true);
  expect((await api.get("/api/auth/get-session")).ok()).toBe(true);
  return api;
}

/** A new Candidate with a Profile: the Coach Action `read_profile` has something to read. */
async function candidateWithProfile(playwright: Playwright, label: string): Promise<{ api: APIRequestContext; profileId: string }> {
  const api = await signedIn(playwright, label);
  const masterCv = {
    fullName: "Marie Dupont", headline: "Contrôleuse de gestion", email: "marie.dupont@example.fr", phone: "", location: "Toulouse", summary: "",
    experience: [{ title: "Contrôleuse de gestion", employer: "Groupe Exemple", location: "Toulouse", period: "2012 – 2024", description: "Budget." }],
    education: [], skills: ["SAP"], languages: [],
  };
  const created = await api.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Contrôle de gestion", locations: ["Toulouse"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return { api, profileId: (await created.json()).id as string };
}

/** A message in the Agenda's conversation; the reply's `sent` as POST /api/coach gave it. */
async function ask(api: APIRequestContext, message: string): Promise<{ sent: ReplyCost | null; conversationId: string }> {
  const answer = await api.post("/api/coach", { data: { subject: { kind: "menu", id: "agenda" }, message } });
  expect(answer.status(), await answer.text()).toBe(200);
  const body = await answer.json();
  return { sent: body.sent ?? null, conversationId: body.conversation.id as string };
}

const twoToolRounds = (profileId: string, n: number) => `Que dit mon profil (${n}) ? ${[1, 2].map(() => `E2E_COACH_TOOL=read_profile:${JSON.stringify({ id: profileId })}`).join(" ")}`;

/** The reply's ReplyCost as AI Usage summed it, from the calls coach_message kept with it. */
async function summedFromUsage(conversationId: string, nth: number): Promise<{ cost: ReplyCost; tasks: string[] }> {
  const [reply] = await query<{ ai_call_ids: string[]; ai_turn_ids: string[]; tool_rounds: number }>(
    `SELECT ai_call_ids, ai_turn_ids, tool_rounds FROM coach_message WHERE author = 'coach' AND conversation_id = $1 ORDER BY seq OFFSET $2 LIMIT 1`,
    [conversationId, nth],
  );
  const calls = await query<{ task: string; input_tokens: number; cached_input_tokens: number; output_tokens: number }>(
    `SELECT task, input_tokens, cached_input_tokens, output_tokens FROM ai_usage WHERE id = ANY($1::uuid[])`,
    [reply!.ai_call_ids],
  );
  const sum = (key: "input_tokens" | "cached_input_tokens" | "output_tokens") => calls.reduce((total, call) => total + call[key], 0);
  return {
    tasks: calls.map((call) => call.task),
    cost: {
      calls: reply!.ai_call_ids.length,
      turns: reply!.ai_turn_ids.length,
      rounds: reply!.tool_rounds,
      inputTokens: sum("input_tokens") + sum("cached_input_tokens"),
      cachedInputTokens: sum("cached_input_tokens"),
      outputTokens: sum("output_tokens"),
    },
  };
}

test.describe.configure({ mode: "serial" });

test.describe("the cost of each AI Coach reply, per message (#805)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_reply_cost", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-reply-cost-e2e-coach-reply-cost-e2e",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_GUARDRAIL_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      COACH_ACTIONS_ENABLED: "true",
      E2E_FAKE_COACH_ACTIONS: "1",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("a reply's cost is the sum of its AI calls: 2 Tool rounds and the Guardrail checks, tokens only, no Tool name", async ({ playwright }) => {
    test.setTimeout(120_000);
    const { api, profileId } = await candidateWithProfile(playwright, "coach-reply-cost");
    const { sent, conversationId } = await ask(api, twoToolRounds(profileId, 1));

    const { cost, tasks } = await summedFromUsage(conversationId, 0);
    expect(tasks).toContain("guardrail");
    expect(tasks.filter((task) => task === "coaching").length).toBeGreaterThanOrEqual(3);
    expect(cost.rounds).toBe(2);
    expect(cost.calls).toBe(tasks.length);
    expect(sent).toEqual(cost);

    // The same figures when the conversation is read back.
    const read = await api.get(`/api/coach/conversations/${conversationId}`);
    expect(read.status()).toBe(200);
    const text = await read.text();
    const replies = (JSON.parse(text).conversation.messages as Message[]).filter((message) => message.from === "coach");
    expect(replies.map((reply) => reply.sent)).toEqual([cost]);
    expect(JSON.parse(text).conversation.context.reply).toEqual(cost);
    // tokens only: a ReplyCost never carries the Coach Actions' internal names (`tools`), nor a euro
    const costs = JSON.stringify([replies[0]!.sent, JSON.parse(text).conversation.context.reply, sent]);
    expect(costs).not.toMatch(/read_profile|tools|tool_names|€|eur/i);
    expect(Object.keys(replies[0]!.sent!).sort()).toEqual(["cachedInputTokens", "calls", "inputTokens", "outputTokens", "rounds", "turns"]);
    expect(text).not.toMatch(/tool_names|"tools"|€|cost_?eur|"eur"/i);
  });

  test("a conversation of 3 replies, 2 after #791 and 1 before, gives 2 ReplyCost and 1 null", async ({ playwright }) => {
    test.setTimeout(150_000);
    const { api, profileId } = await candidateWithProfile(playwright, "coach-reply-cost-3");
    const first = await ask(api, twoToolRounds(profileId, 1));
    const conversationId = first.conversationId;
    const second = await ask(api, twoToolRounds(profileId, 2));
    const third = await ask(api, twoToolRounds(profileId, 3));
    expect(second.conversationId).toBe(conversationId);
    expect(third.conversationId).toBe(conversationId);
    // The first reply as saved before #791: no AI call kept with it.
    const aged = await query(
      `UPDATE coach_message SET ai_call_ids = NULL, ai_turn_ids = NULL, tool_rounds = NULL, tool_names = NULL
        WHERE seq = (SELECT min(seq) FROM coach_message WHERE author = 'coach' AND conversation_id = $1) AND conversation_id = $1 RETURNING seq`,
      [conversationId],
    );
    expect(aged).toHaveLength(1);

    // GET /api/coach/conversations/[id]
    const read = await api.get(`/api/coach/conversations/${conversationId}`);
    expect(read.status()).toBe(200);
    const body = await read.json();
    const messages = body.conversation.messages as Message[];
    const replies = messages.filter((message) => message.from === "coach");
    expect(replies).toHaveLength(3);
    expect(replies.map((reply) => reply.sent)).toEqual([null, second.sent, third.sent]);
    expect(replies.filter((reply) => reply.sent !== null)).toHaveLength(2);
    expect(replies.filter((reply) => reply.sent === null)).toHaveLength(1);
    expect(messages.filter((message) => message.from === "candidate").every((message) => !("sent" in message))).toBe(true);
    for (const cost of [second.sent!, third.sent!]) expect(Object.keys(cost).sort()).toEqual(["cachedInputTokens", "calls", "inputTokens", "outputTokens", "rounds", "turns"]);
  });

  test("a Candidate's other conversations stay theirs: the cost of a reply is not served to another Candidate", async ({ playwright }) => {
    test.setTimeout(120_000);
    const { api, profileId } = await candidateWithProfile(playwright, "coach-reply-cost-own");
    const { conversationId } = await ask(api, twoToolRounds(profileId, 1));
    const other = await signedIn(playwright, "coach-reply-cost-other");
    expect((await other.get(`/api/coach/conversations/${conversationId}`)).status()).toBe(404);
    expect((await api.get(`/api/coach/conversations/${conversationId}`)).status()).toBe(200);
  });
});
