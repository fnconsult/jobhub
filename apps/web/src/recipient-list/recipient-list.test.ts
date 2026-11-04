import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import type { ToolsState } from "../tools/index";
import { datedRecipientList, fingerprintOf, migrateRecipientList, recipientsSwitchedOn } from "./index";

const connectionString = process.env.DATABASE_URL;

/** The Tools' state: the values in use, the Sign-in Providers enabled, the Platform Settings read from them. */
const stateOf = (env: Record<string, string> = {}, signInTypes: string[] = []): ToolsState => ({ env, signInTypes, settings: snapshotOfSettings(env, {}) });

describe("the Recipient list's recipients (ADR-0064, #338)", () => {
  it("are the Hosts and each Tool that can be called and receives personal data, as Outils reads them", () => {
    const ids = recipientsSwitchedOn(stateOf({ ANTHROPIC_API_KEY: "sk", MISTRAL_API_KEY: "mk", PERPLEXITY_API_KEY: "pk", STRIPE_SECRET_KEY: "s", STRIPE_WEBHOOK_SECRET: "w" }, ["google"])).map((recipient) => recipient.id);
    expect(ids).toEqual(expect.arrayContaining(["hostinger", "anthropic", "mistral", "perplexity", "stripe", "google"]));
    expect(ids.slice(0, 2)).toEqual(["hostinger", "scaleway"]);
    // A Tool without its key, a Sign-in Provider not enabled, a Tool that receives no personal data: none listed.
    expect(ids).not.toContain("brave");
    expect(ids).not.toContain("apple");
    expect(ids).not.toContain("greenhouse");
    // Email intake runs on Jobbbox's own servers: Hostinger is its recipient.
    expect(ids).not.toContain("email-intake");
  });

  it("leave out a Tool its settings switch off: an enrichment provider until its DPA is signed", () => {
    expect(recipientsSwitchedOn(stateOf({ CONTACT_ENRICHMENT_PROVIDER: "lusha", LUSHA_API_KEY: "k" })).map((recipient) => recipient.id)).not.toContain("lusha");
  });
});

describe.skipIf(!connectionString)("the day the Recipient list last changed (#338; needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_recipient_list");
    database = throwaway.pool;
    await migrateRecipientList(database);
    await migrateRecipientList(database); // safe to run twice
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  const one = recipientsSwitchedOn(stateOf({ ANTHROPIC_API_KEY: "sk" }));
  const two = recipientsSwitchedOn(stateOf({ ANTHROPIC_API_KEY: "sk", PERPLEXITY_API_KEY: "pk" }));

  it("is the first time the list was served as it reads now, and stays while it does not change", async () => {
    const first = new Date("2026-11-01T09:00:00Z");
    expect((await datedRecipientList(database, one, first)).changedAt).toEqual(first);
    expect((await datedRecipientList(database, one, new Date("2026-11-03T09:00:00Z"))).changedAt).toEqual(first);
    const { rows } = await database.query("SELECT count(*)::int AS n FROM recipient_list_change");
    expect(rows[0].n).toBe(1);
  });

  it("moves when a recipient is switched on, and again when it is switched off", async () => {
    await datedRecipientList(database, one, new Date("2026-11-01T09:00:00Z"));
    const on = new Date("2026-11-02T09:00:00Z");
    expect((await datedRecipientList(database, two, on)).changedAt).toEqual(on);
    const off = new Date("2026-11-03T09:00:00Z");
    expect((await datedRecipientList(database, one, off)).changedAt).toEqual(off);
  });

  it("moves when a fact the page shows changes in the catalog", async () => {
    await datedRecipientList(database, one, new Date("2026-11-01T09:00:00Z"));
    const changed = one.map((recipient) => (recipient.id === "anthropic" ? { ...recipient, facts: { ...recipient.facts, safeguards: ["dpf", "scc"] as const } } : recipient));
    expect(fingerprintOf(changed)).not.toBe(fingerprintOf(one));
    const at = new Date("2026-11-02T09:00:00Z");
    expect((await datedRecipientList(database, changed, at)).changedAt).toEqual(at);
  });
});
