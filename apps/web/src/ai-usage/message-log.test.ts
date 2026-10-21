import { AiConfigError, AiProviderError, createAiLayer, type AiLayer, type UsageLog } from "@jobhub/ai";
import { createFakeProvider } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice } from "../admin/back-office";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createPostgresUsageLog, MESSAGE_LOG_MAX_LENGTH, migrateAiUsage, purgeExpiredAiUsage } from "./index";
import { createAiMessageLogs, type AiMessageLogs } from "./message-log";

const PROVIDER_KEY = "mk-2f9c41d7a0b34e5f";

describe.skipIf(!connectionString)("AI Message Log (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let logs: AiMessageLogs;
  let ai: AiLayer;
  let now: Date;
  let pending: Promise<unknown>[];
  let marie: string;
  const admin = { id: "", email: "admin@jobbbox.example" };

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateBackOfficeAudit(database);
    await migrateAiUsage(database);
    marie = await candidate("marie.dupont@example.fr");
    admin.id = await candidate(admin.email);
    backOffice = createBackOffice(database, { billing: {} as never, humanCoaches: {} as never });
    logs = createAiMessageLogs(database, { backOffice });
    pending = [];
    now = new Date("2026-10-17T08:00:00Z");
    const postgres = createPostgresUsageLog(database, { secrets: () => [PROVIDER_KEY, undefined] });
    const usage: UsageLog = { record: (entry) => void pending.push(Promise.resolve(postgres.record(entry))) };
    ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral", reply: (input) => `Réponse à ${input.messages.at(-1)!.content}` })],
      routes: { coaching: "mistral", scoring: { provider: "mistral", model: "mistral-small-latest" } },
      usage,
      now: () => now,
    });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  const settled = () => Promise.all(pending);

  it("keeps what each AI call said, with its Candidate, for a super-admin to read", async () => {
    await ai.generate({ task: "coaching", candidateId: marie, system: "Tu es le coach.", prompt: [{ role: "user", content: "Comment négocier ?" }] });
    await settled();

    const [summary] = await logs.list();
    expect(summary).toEqual({
      id: expect.any(String),
      at: now,
      task: "coaching",
      provider: "mistral",
      model: "fake-mistral",
      outcome: "ok",
      reason: null,
      sent: true,
      candidate: { id: marie, email: "marie.dupont@example.fr" },
    });
    expect(await logs.open(admin, summary!.id)).toMatchObject({
      ...summary,
      system: "Tu es le coach.",
      messages: [{ role: "user", content: "Comment négocier ?" }],
      reply: "Réponse à Comment négocier ?",
      inputTokens: 10,
      outputTokens: 5,
      costEur: expect.any(Number),
      durationMs: expect.any(Number),
      technicalReason: null,
    });
  });

  it("writes every view of a message log to the Back Office Audit: who viewed which, when", async () => {
    await ai.generate({ task: "coaching", candidateId: marie, prompt: "Bonjour" });
    await settled();
    const [summary] = await logs.list();

    await logs.open(admin, summary!.id);
    await logs.open(admin, summary!.id);

    expect(await backOffice.journal({ section: "ai_messages" })).toEqual([
      expect.objectContaining({ actor: { candidateId: admin.id, email: admin.email }, section: "ai_messages", target: summary!.id, action: "viewed" }),
      expect.objectContaining({ target: summary!.id, action: "viewed" }),
    ]);
  });

  it("opens nothing, and records nothing, for a log that does not exist", async () => {
    expect(await logs.open(admin, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await logs.open(admin, "not-an-id")).toBeNull();

    expect(await backOffice.journal({ section: "ai_messages" })).toEqual([]);
  });

  it("never stores a Provider Secret or anything shaped like a key, in the prompt or the reply", async () => {
    await ai.generate({ task: "coaching", candidateId: marie, system: `Clé : ${PROVIDER_KEY}`, prompt: "Mon token: sk-live-abcdefghijklmnop et Bearer eyJhbGciOiJIUzI1NiJ9" });
    await settled();
    const [summary] = await logs.list();

    const stored = JSON.stringify(await logs.open(admin, summary!.id));
    expect(stored).not.toContain(PROVIDER_KEY);
    expect(stored).not.toMatch(/sk-live|eyJhbGci/);
    expect(stored).toContain("[redacted]");
  });

  it("keeps no message log for a Candidate who no longer exists (deleted while the call ran): never a log without its owner", async () => {
    await ai.generate({ task: "coaching", candidateId: "a-deleted-candidate", prompt: "Bonjour" });
    await settled();

    expect(await logs.list()).toEqual([]);
    const { rows } = await database.query(`SELECT count(*)::int AS calls FROM ai_usage`);
    expect(rows).toEqual([{ calls: 1 }]);
  });

  it("keeps UUIDs and URLs in what it stores, and caps each text at MESSAGE_LOG_MAX_LENGTH with a marker", async () => {
    const long = "x".repeat(MESSAGE_LOG_MAX_LENGTH + 5_000);
    const prompt = `Profil 6ea8e01c-2313-486c-8ef9-7ee619a374fa, https://www.apec.fr/offre/directeur-financier-lyon-2026 ${long}`;
    await ai.generate({ task: "coaching", candidateId: marie, system: long, prompt });
    await settled();
    const [summary] = await logs.list();

    const log = (await logs.open(admin, summary!.id))!;
    expect(log.messages[0]!.content).toContain("6ea8e01c-2313-486c-8ef9-7ee619a374fa");
    expect(log.messages[0]!.content).toContain("https://www.apec.fr/offre/directeur-financier-lyon-2026");
    for (const text of [log.system!, log.messages[0]!.content]) {
      expect(text.length).toBeLessThanOrEqual(MESSAGE_LOG_MAX_LENGTH + 100);
      expect(text).toMatch(/\[truncated: \d+ characters\]$/);
    }
  });

  it("does its scrubbing and writing after the AI call has returned, never on its stack", async () => {
    let asked = 0;
    const usage = createPostgresUsageLog(database, { secrets: () => (asked++, []) });

    const recorded = usage.record({ candidateId: null, task: "scoring", provider: "mistral", endpoint: "fake", model: "m", inputTokens: 1, outputTokens: 1, outcome: "ok", sent: true, durationMs: 1, costEur: 0, tools: [], transcript: { messages: [{ role: "user", content: "Score" }], reply: "82" }, at: now });

    expect(asked).toBe(0);
    await recorded;
    expect(asked).toBe(1);
  });

  it("keeps a call made for no Candidate (a Guest), and a failed call with no reply", async () => {
    const failing = createAiLayer({
      providers: [{ ...createFakeProvider({ id: "mistral" }), generate: () => Promise.reject(new Error("HTTP 503")) }],
      routes: { scoring: "mistral" },
      usage: { record: (entry) => void pending.push(Promise.resolve(createPostgresUsageLog(database).record(entry))) },
      now: () => now,
    });
    await expect(failing.generate({ task: "scoring", candidateId: null, prompt: "Score" })).rejects.toThrow();
    await settled();

    const [summary] = await logs.list();
    expect(summary).toMatchObject({ outcome: "failed", reason: "other", sent: true, candidate: null });
    expect(await logs.open(admin, summary!.id)).toMatchObject({ messages: [{ role: "user", content: "Score" }], reply: null });
  });

  it("lists the newest first, filtered by task, model, Candidate email and day (Paris time)", async () => {
    const jean = await candidate("jean.martin@example.fr");
    now = new Date("2026-10-16T21:30:00Z"); // 23:30 in Paris
    await ai.generate({ task: "coaching", candidateId: marie, prompt: "Un" });
    now = new Date("2026-10-17T08:00:00Z");
    await ai.generate({ task: "scoring", candidateId: jean, prompt: "Deux" });
    now = new Date("2026-10-17T09:00:00Z");
    await ai.generate({ task: "coaching", candidateId: jean, prompt: "Trois" });
    await settled();

    const tasks = async (filter: unknown) => (await logs.list(filter)).map((log) => `${log.task} ${log.candidate?.email}`);
    expect(await tasks({})).toEqual(["coaching jean.martin@example.fr", "scoring jean.martin@example.fr", "coaching marie.dupont@example.fr"]);
    expect(await tasks({ task: "coaching" })).toEqual(["coaching jean.martin@example.fr", "coaching marie.dupont@example.fr"]);
    expect(await tasks({ model: "mistral-small-latest" })).toEqual(["scoring jean.martin@example.fr"]);
    expect(await tasks({ email: " Marie.Dupont@example.fr " })).toEqual(["coaching marie.dupont@example.fr"]);
    expect(await tasks({ day: "2026-10-16" })).toEqual(["coaching marie.dupont@example.fr"]);
    // A filter that cannot be read is no filter.
    expect(await tasks({ task: "nope", day: "yesterday", model: 3 })).toHaveLength(3);
  });

  it("purges message logs 30 days old, the usage stays", async () => {
    await ai.generate({ task: "coaching", candidateId: marie, prompt: "Bonjour" });
    await settled();

    // The row is stamped with the call's clock (now, set above), so the cut-offs are measured from it.
    const day = 24 * 60 * 60 * 1000;
    expect(await purgeExpiredAiUsage(database, new Date(now.getTime() + 29 * day))).toEqual({ usage: 0, externalApis: 0, messageLogs: 0 });
    expect(await purgeExpiredAiUsage(database, new Date(now.getTime() + 31 * day))).toEqual({ usage: 0, externalApis: 0, messageLogs: 1 });
    expect(await logs.list()).toEqual([]);
  });

  it("goes with the Candidate's account", async () => {
    await ai.generate({ task: "coaching", candidateId: marie, prompt: "Bonjour" });
    await settled();

    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);

    expect(await logs.list()).toEqual([]);
  });

  describe("the Failure Reason of each failed call (#259)", () => {
    const failingWith = (fail: Error) =>
      createAiLayer({
        providers: [createFakeProvider({ id: "mistral", fail })],
        routes: { coaching: "mistral", scoring: "mistral" },
        usage: { record: (entry) => void pending.push(Promise.resolve(createPostgresUsageLog(database, { secrets: () => [PROVIDER_KEY] }).record(entry))) },
        now: () => now,
        warn: () => {},
      });

    it("keeps a provider's 503 as failed, provider_unavailable, with the provider and status 503 in the technical reason", async () => {
      await expect(failingWith(new AiProviderError("mistral", "HTTP 503 Service Unavailable", 503)).generate({ task: "coaching", candidateId: marie, prompt: "Bonjour" })).rejects.toThrow();
      await settled();

      const [summary] = await logs.list();
      expect(summary).toMatchObject({ outcome: "failed", reason: "provider_unavailable", sent: true });
      expect(await logs.open(admin, summary!.id)).toMatchObject({
        reply: null,
        technicalReason: { class: "AiProviderError", provider: "mistral", status: 503, message: "mistral: HTTP 503 Service Unavailable" },
      });
      const { rows } = await database.query(`SELECT outcome, reason, ok FROM ai_usage`);
      expect(rows).toEqual([{ outcome: "failed", reason: "provider_unavailable", ok: false }]);
    });

    it("keeps a call never sent for a missing key as failed, not sent, key_missing, at no cost, with its redacted text", async () => {
      await expect(ai.generate({ task: "coaching", candidateId: marie, prompt: "Écris à marie.dupont@example.fr", route: { provider: "openai", model: "gpt-5" } })).rejects.toThrow(AiConfigError);
      await settled();

      const [summary] = await logs.list();
      expect(summary).toMatchObject({ provider: "openai", model: "gpt-5", outcome: "failed", reason: "key_missing", sent: false });
      expect(await logs.open(admin, summary!.id)).toMatchObject({ costEur: 0, inputTokens: 0, outputTokens: 0, reply: null, messages: [{ role: "user", content: "Écris à [E-MAIL]" }] });
    });

    it("stores a technical message holding a Provider Secret, an email or more than 500 characters scrubbed, redacted and cut", async () => {
      const echo = `HTTP 400 key ${PROVIDER_KEY} refused for marie.dupont@example.fr ${"et ainsi de suite ".repeat(40)}`;
      await expect(failingWith(new AiProviderError("mistral", echo, 400)).generate({ task: "coaching", candidateId: marie, prompt: "Bonjour" })).rejects.toThrow();
      await settled();

      const [summary] = await logs.list();
      const { technicalReason } = (await logs.open(admin, summary!.id))!;
      expect(technicalReason!.message).not.toContain(PROVIDER_KEY);
      expect(technicalReason!.message).toContain("[redacted]");
      expect(technicalReason!.message).not.toContain("marie.dupont@example.fr");
      expect(technicalReason!.message.length).toBeLessThanOrEqual(500);
    });

    it("lists by Outcome and by Failure Reason, combined with the other filters", async () => {
      await ai.generate({ task: "coaching", candidateId: marie, prompt: "Un" });
      await expect(failingWith(new AiProviderError("mistral", "HTTP 503", 503)).generate({ task: "scoring", candidateId: marie, prompt: "Deux" })).rejects.toThrow();
      await expect(failingWith(new AiProviderError("mistral", "HTTP 429", 429)).generate({ task: "coaching", candidateId: marie, prompt: "Trois" })).rejects.toThrow();
      await settled();

      const listed = async (filter: unknown) => (await logs.list(filter)).map((log) => `${log.task} ${log.outcome} ${log.reason}`).sort();
      expect(await listed({ outcome: "ok" })).toEqual(["coaching ok null"]);
      expect(await listed({ outcome: "failed" })).toEqual(["coaching failed rate_limited", "scoring failed provider_unavailable"]);
      expect(await listed({ outcome: "warning" })).toEqual([]);
      expect(await listed({ reason: "rate_limited" })).toEqual(["coaching failed rate_limited"]);
      expect(await listed({ outcome: "failed", task: "scoring" })).toEqual(["scoring failed provider_unavailable"]);
      // A value that cannot be read is no filter.
      expect(await listed({ outcome: "nope", reason: "nope" })).toHaveLength(3);
    });
  });
});
