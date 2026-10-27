import type { UsageEntry } from "@jobhub/ai";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresUsageLog, migrateAiUsage } from "../ai-usage/index";
import type { MailMessage } from "../auth/index";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { createWebSearchAlert, migrateWebSearchAlerts, postgresWebSearchAlertStore, type SentWebSearchAlert, type WebSearchAlertStore } from "./index";

/** The web search spend of each month (Paris time) and the alerts sent, kept in memory. */
function memoryStore(spend: Record<string, number> = {}): WebSearchAlertStore & { spend: Record<string, number> } {
  const sent = new Map<string, SentWebSearchAlert>();
  return {
    spend,
    spendEur: async (month) => spend[month] ?? 0,
    claim: async (alert) => {
      if (sent.has(alert.month)) return false;
      sent.set(alert.month, alert);
      return true;
    },
    release: async (month) => void sent.delete(month),
    sent: async (month) => sent.get(month) ?? null,
  };
}

function setup(options: { spend?: Record<string, number>; threshold?: number; failSending?: boolean } = {}) {
  const store = memoryStore(options.spend);
  const outbox: MailMessage[] = [];
  let failing = options.failSending ?? false;
  const clock = { now: new Date("2026-10-27T10:00:00Z") };
  let threshold = options.threshold ?? 2;
  const alert = createWebSearchAlert({
    store,
    thresholdEur: () => threshold,
    superAdmins: async () => ["ops@jobbbox.ai", "cto@jobbbox.ai"],
    mailer: {
      send: async (message) => {
        if (failing) throw new Error("SMTP down");
        outbox.push(message);
      },
    },
    appUrl: "https://app.jobbbox.ai",
    now: () => clock.now,
  });
  return { alert, store, outbox, clock, setThreshold: (eur: number) => (threshold = eur), stopFailing: () => (failing = false) };
}

describe("the monthly web search alert (#403)", () => {
  it("sends nothing while the month's web search spend is below its threshold", async () => {
    const { alert, outbox } = setup({ spend: { "2026-10": 1.99 } });

    expect(await alert.check()).toMatchObject({ month: "2026-10", spendEur: 1.99, thresholdEur: 2, outcome: "below" });
    expect(outbox).toEqual([]);
  });

  it("threshold crossing sends one email per month: to each super-admin once, however often it is checked", async () => {
    const { alert, store, outbox, clock } = setup({ spend: { "2026-10": 2.4 } });

    expect(await alert.check()).toMatchObject({ outcome: "sent", spendEur: 2.4 });
    store.spend["2026-10"] = 3.1;
    expect(await alert.check()).toMatchObject({ outcome: "already_sent", spendEur: 3.1 });
    expect(await alert.check()).toMatchObject({ outcome: "already_sent" });

    expect(outbox.map((mail) => mail.to)).toEqual(["ops@jobbbox.ai", "cto@jobbbox.ai"]);
    expect(outbox[0]!.subject).toContain("recherche web");
    expect(outbox[0]!.text).toContain("2,40");
    expect(outbox[0]!.text).toContain("https://app.jobbbox.ai/admin/consommation-ia");
    // Nothing is cut: the email says so.
    expect(outbox[0]!.text).toContain("Rien n'est coupé");

    // November starts below the threshold, then crosses it: one more email each.
    clock.now = new Date("2026-11-03T08:00:00Z");
    store.spend["2026-11"] = 0.5;
    expect(await alert.check()).toMatchObject({ month: "2026-11", outcome: "below" });
    store.spend["2026-11"] = 2;
    expect(await alert.check()).toMatchObject({ month: "2026-11", outcome: "sent" });
    expect(outbox).toHaveLength(4);
  });

  it("counts the month in Paris time: 23:30 UTC on 31 October is already November", async () => {
    const { alert, clock } = setup({ spend: { "2026-11": 5 } });
    clock.now = new Date("2026-10-31T23:30:00Z");

    expect(await alert.check()).toMatchObject({ month: "2026-11", outcome: "sent" });
  });

  it("alerts nobody with a threshold of 0", async () => {
    const { alert, outbox } = setup({ spend: { "2026-10": 50 }, threshold: 0 });

    expect(await alert.check()).toMatchObject({ outcome: "off" });
    expect(outbox).toEqual([]);
  });

  it("tries again at the next check when the email could not be sent", async () => {
    const { alert, outbox, stopFailing } = setup({ spend: { "2026-10": 2.4 }, failSending: true });

    await expect(alert.check()).rejects.toThrow("SMTP down");
    stopFailing();
    expect(await alert.check()).toMatchObject({ outcome: "sent" });
    expect(outbox).toHaveLength(2);
  });

  it("says, for the banner, whether the month crossed its threshold and when super-admins were emailed", async () => {
    const { alert, clock } = setup({ spend: { "2026-10": 2.4 } });

    expect(await alert.state()).toEqual({ month: "2026-10", spendEur: 2.4, thresholdEur: 2, crossed: true, emailedAt: null });
    await alert.check();
    expect(await alert.state()).toEqual({ month: "2026-10", spendEur: 2.4, thresholdEur: 2, crossed: true, emailedAt: clock.now });
  });
});

describe.skipIf(!connectionString)("the months' web search spend and alerts, in Postgres (needs DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  const now = new Date("2026-10-27T10:00:00Z");

  beforeAll(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateAiUsage(database);
    await migrateWebSearchAlerts(database);
  });
  afterAll(() => testAuth.stop());

  const call = (task: UsageEntry["task"], at: Date, costEur: number, tools: number[]): UsageEntry => ({
    candidateId: null,
    task,
    provider: task === "web_search" ? "perplexity" : "mistral",
    endpoint: "fake",
    model: "fast",
    inputTokens: 0,
    outputTokens: 0,
    outcome: "ok",
    sent: true,
    durationMs: 10,
    costEur,
    tools: tools.map((fee) => ({ name: "web_search", count: 1, ok: true, durationMs: 10, costEur: fee })),
    transcript: { messages: [], reply: null },
    at,
  });

  it("sums the month's web_search calls, their tokens and billed units, Paris time; an unknown price counts 0", async () => {
    const log = createPostgresUsageLog(database);
    await log.record(call("web_search", new Date("2026-10-02T09:00:00Z"), 0.01, [0.5]));
    await log.record(call("web_search", new Date("2026-10-31T22:30:00Z"), 0, [0.25, null as unknown as number]));
    // Another task, and the previous month (23:30 UTC on 30 September is still September in Paris), are left out.
    await log.record(call("offer_analysis", new Date("2026-10-05T09:00:00Z"), 3, []));
    await log.record(call("web_search", new Date("2026-09-30T21:30:00Z"), 0, [9]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await postgresWebSearchAlertStore(database, () => now).spendEur("2026-10")).toBeCloseTo(0.76, 9);
  });

  it("keeps one alert a month: claimed once, given back when its emails failed", async () => {
    const store = postgresWebSearchAlertStore(database, () => now);
    const alert = { month: "2026-10", spendEur: 2.5, thresholdEur: 2, at: now };

    expect(await store.claim(alert)).toBe(true);
    expect(await store.claim(alert)).toBe(false);
    expect(await store.sent("2026-10")).toEqual(alert);
    await store.release("2026-10");
    expect(await store.sent("2026-10")).toBeNull();
    expect(await store.claim(alert)).toBe(true);
  });
});
