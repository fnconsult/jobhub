import { toolById, type Tool } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdministratorRecipient } from "../admin/administrators";
import type { MailMessage } from "../auth/index";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import type { ToolQuotaState } from "../tool-quotas/index";
import { createToolQuotaAlert, migrateToolQuotaAlerts, postgresToolQuotaAlertStore, type ToolQuotaAlertStore } from "./index";

const tool = (id: string) => toolById(id) as Tool;

/** Each Tool's quota state: ok unless `refused` says otherwise. */
function statesOf(refused: Record<string, Pick<ToolQuotaState, "state" | "since">>): ToolQuotaState[] {
  return ["anthropic", "mistral", "openai", "tavily"].map((id) => ({ tool: tool(id), renewsAt: null, ...(refused[id] ?? { state: "ok", since: null }) }));
}

/** The days whose alert was taken, kept in memory. */
function memoryStore(): ToolQuotaAlertStore & { days: Map<string, string[]> } {
  const days = new Map<string, string[]>();
  return {
    days,
    claim: async ({ day, tools }) => {
      if (days.has(day)) return false;
      days.set(day, tools);
      return true;
    },
    release: async (day) => void days.delete(day),
  };
}

const ADMINISTRATORS: AdministratorRecipient[] = [
  { email: "claire@jobbbox.fr", language: "fr", roles: ["super-admin"] },
  { email: "marie@example.fr", language: "en", roles: ["platform-manager"] },
  // A role that reads neither Paramètres nor Outils: the email all the same, without a link to configure.
  { email: "sophie@example.fr", language: "fr", roles: ["coach-manager"] },
];

function setup(options: { refused?: Record<string, Pick<ToolQuotaState, "state" | "since">>; failSending?: boolean } = {}) {
  const store = memoryStore();
  const outbox: MailMessage[] = [];
  let failing = options.failSending ?? false;
  const clock = { now: new Date("2026-11-25T09:00:00Z") };
  const world = { refused: options.refused ?? {} };
  const read: Date[] = [];
  const alert = createToolQuotaAlert({
    store,
    states: async (now) => {
      read.push(now);
      return statesOf(world.refused);
    },
    administrators: async () => ADMINISTRATORS,
    mailer: {
      send: async (message) => {
        if (failing) throw new Error("SMTP down");
        outbox.push(message);
      },
    },
    appUrl: "https://app.jobbbox.ai",
    now: () => clock.now,
  });
  return { alert, store, outbox, clock, world, read, stopFailing: () => (failing = false) };
}

const since = new Date("2026-11-25T08:42:00Z");

describe("the daily « Quota atteint » email (#1117)", () => {
  it("a first quota reached in the day emails each Administrator, whatever their role, in their language", async () => {
    const { alert, outbox, read, clock } = setup({ refused: { openai: { state: "quota_exhausted", since } } });

    expect(await alert.check()).toEqual({ day: "2026-11-25", tools: ["openai"], outcome: "sent" });
    expect(read).toEqual([clock.now]);

    expect(outbox.map((mail) => mail.to)).toEqual(["claire@jobbbox.fr", "marie@example.fr", "sophie@example.fr"]);
    const [claire, marie, sophie] = outbox;
    expect(claire!.subject).toBe("Jobbbox : quota atteint pour OpenAI");
    // The Tool, its state, since when (Paris time), and the banner's two links.
    expect(claire!.text).toContain("OpenAI : quota épuisé depuis le 25 nov. 2026, 09:42.");
    expect(claire!.text).toContain("Configurer OpenAI :\nhttps://app.jobbbox.ai/admin/outils/openai");
    expect(claire!.text).toContain("Facturation de OpenAI :\nhttps://platform.openai.com/settings/organization/billing/overview");
    expect(claire!.text).toContain("administrateur");

    expect(marie!.subject).toBe("Jobbbox: quota reached for OpenAI");
    expect(marie!.text).toContain("OpenAI: quota used up since 25 Nov 2026, 09:42.");
    expect(marie!.text).toContain("https://app.jobbbox.ai/admin/outils/openai");

    expect(sophie!.text).not.toContain("Configurer OpenAI");
    expect(sophie!.text).toContain("Facturation de OpenAI :\nhttps://platform.openai.com/settings/organization/billing/overview");
  });

  it("a second Tool reached the same day sends no new email; it is in the next day's while still reached", async () => {
    const { alert, outbox, clock, world } = setup({ refused: { openai: { state: "quota_exhausted", since } } });
    await alert.check();

    world.refused.mistral = { state: "rate_limited", since: new Date("2026-11-25T15:00:00Z") };
    expect(await alert.check()).toEqual({ day: "2026-11-25", tools: ["mistral", "openai"], outcome: "already_sent" });
    expect(outbox).toHaveLength(3);

    // The next day, Paris time (23:30 UTC on the 25th is already the 26th): one email, listing both while still reached.
    clock.now = new Date("2026-11-25T23:30:00Z");
    expect(await alert.check()).toEqual({ day: "2026-11-26", tools: ["mistral", "openai"], outcome: "sent" });
    expect(outbox).toHaveLength(6);
    expect(outbox[3]!.subject).toBe("Jobbbox : quota atteint pour Mistral AI et OpenAI");
    expect(outbox[3]!.text).toContain("Mistral AI : limite atteinte depuis le 25 nov. 2026, 16:00.");
    expect(outbox[3]!.text).toContain("OpenAI : quota épuisé depuis le 25 nov. 2026, 09:42.");

    // A Tool whose quota is available again is no longer listed.
    delete world.refused.openai;
    clock.now = new Date("2026-11-27T07:00:00Z");
    expect(await alert.check()).toEqual({ day: "2026-11-27", tools: ["mistral"], outcome: "sent" });
    expect(outbox[6]!.subject).toBe("Jobbbox : quota atteint pour Mistral AI");
    expect(outbox[6]!.text).not.toContain("OpenAI");
  });

  it("a day with no quota reached sends nothing, and no email says a quota is available again", async () => {
    const { alert, outbox, clock, world, store } = setup();

    expect(await alert.check()).toEqual({ day: "2026-11-25", tools: [], outcome: "none" });
    expect(outbox).toEqual([]);
    expect(store.days.size).toBe(0);

    world.refused.openai = { state: "rate_limited", since };
    await alert.check();
    world.refused = {};
    clock.now = new Date("2026-11-26T09:00:00Z");
    expect(await alert.check()).toEqual({ day: "2026-11-26", tools: [], outcome: "none" });
    expect(outbox).toHaveLength(3);
  });

  it("a send that fails gives the day back, and the next check tries again", async () => {
    const { alert, outbox, store, stopFailing } = setup({ refused: { tavily: { state: "quota_exhausted", since } }, failSending: true });

    await expect(alert.check()).rejects.toThrow("SMTP down");
    expect(store.days.size).toBe(0);

    stopFailing();
    expect(await alert.check()).toMatchObject({ outcome: "sent" });
    expect(outbox).toHaveLength(3);
    expect(store.days.get("2026-11-25")).toEqual(["tavily"]);
  });
});

describe.skipIf(!connectionString)("the days' « Quota atteint » emails, in Postgres (needs DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeAll(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateToolQuotaAlerts(database);
    await migrateToolQuotaAlerts(database); // safe to run again
  });
  afterAll(() => testAuth.stop());

  it("keeps one alert a day: taken once, given back when its emails failed", async () => {
    const store = postgresToolQuotaAlertStore(database);
    const alert = { day: "2026-11-25", tools: ["openai", "mistral"], at: new Date("2026-11-25T09:00:00Z") };

    expect(await store.claim(alert)).toBe(true);
    expect(await store.claim({ ...alert, tools: ["tavily"] })).toBe(false);
    const { rows } = await database.query(`SELECT day, tools, sent_at FROM tool_quota_alert`);
    expect(rows).toEqual([{ day: "2026-11-25", tools: ["openai", "mistral"], sent_at: alert.at }]);

    await store.release("2026-11-25");
    expect(await store.claim(alert)).toBe(true);
    expect(await store.claim({ ...alert, day: "2026-11-26" })).toBe(true);
  });
});
