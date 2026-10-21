import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { DEFAULT_GUARDRAIL_MESSAGES, GUARDRAIL_IDS } from "./index";
import { createGuardrailStore, migrateGuardrails, purgeExpiredGuardrailTriggers, TRIGGER_RETENTION_MONTHS, type GuardrailStore } from "./store";

const connectionString = process.env.DATABASE_URL;

const claire = { email: "Claire@jobbbox.fr" };
const paul = { email: "paul@jobbbox.fr", name: "Paul Martin" };

describe.skipIf(!connectionString)("Guardrail settings, Guardrail messages and Guardrail Triggers in the database (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let store: GuardrailStore;
  const storeFor = (serving: "validated" | "latest") => createGuardrailStore(database, { serving });

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_guardrails");
    database = throwaway.pool;
    await migrateGuardrails(database);
    await migrateGuardrails(database);
    store = storeFor("latest");
  });

  afterEach(async () => {
    await throwaway?.drop();
  });

  describe("settings", () => {
    it("blocks with every Guardrail until a super-admin says otherwise", async () => {
      const { settings } = await store.config.current();

      expect(settings).toEqual(Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, "block"])));
    });

    it("sets one that can be switched to flag only, and back", async () => {
      const flagged = await store.setSetting("harmful_advice", "flag");
      const unchanged = await store.setSetting("harmful_advice", "flag");

      expect(flagged).toEqual({ ok: true, before: "block", after: "flag", changed: true });
      expect(unchanged).toEqual({ ok: true, before: "flag", after: "flag", changed: false });
      expect((await store.config.current()).settings.harmful_advice).toBe("flag");
      expect((await store.list()).find((each) => each.id === "harmful_advice")).toMatchObject({ setting: "flag", alwaysOn: false });
    });

    it("refuses to switch off distress, personal data leak or secret disclosure, and unknown Guardrails or settings", async () => {
      for (const id of ["distress", "personal_data_leak", "secret_disclosure"]) expect(await store.setSetting(id, "flag")).toEqual({ ok: false, error: "always_on" });
      expect(await store.setSetting("nope", "flag")).toEqual({ ok: false, error: "not_found" });
      expect(await store.setSetting("prompt_injection", "off")).toEqual({ ok: false, error: "invalid" });
      expect((await store.config.current()).settings.distress).toBe("block");
    });
  });

  describe("Guardrail messages", () => {
    it("serves the default text from code until one is written", async () => {
      const { messages } = await store.config.current();

      expect(messages).toEqual(DEFAULT_GUARDRAIL_MESSAGES);
    });

    it("serves the latest message in other environments, and in production only once Human-validated by someone other than its author, each language apart", async () => {
      const saved = await store.saveMessage(claire, "distress", "fr", "  Appelez le 3114, à toute heure.  ");
      await store.saveMessage(claire, "distress", "en", "Call 3114, any time.");
      const production = storeFor("validated");

      expect(saved).toMatchObject({ ok: true, before: null, version: { guardrail: "distress", language: "fr", version: 1, text: "Appelez le 3114, à toute heure.", author: "claire@jobbbox.fr", validation: null } });
      expect((await store.config.current()).messages.distress).toEqual({ fr: "Appelez le 3114, à toute heure.", en: "Call 3114, any time." });
      expect((await production.config.current()).messages.distress).toEqual(DEFAULT_GUARDRAIL_MESSAGES.distress);

      expect(await production.validateMessage({ email: "claire@jobbbox.fr", name: "Claire" }, "distress", "fr", 1)).toEqual({ ok: false, error: "own_message" });
      const validated = await production.validateMessage(paul, "distress", "fr", 1);

      expect(validated).toMatchObject({ ok: true, version: { version: 1, validation: { name: "Paul Martin", email: "paul@jobbbox.fr" } } });
      expect((await production.config.current()).messages.distress).toEqual({ fr: "Appelez le 3114, à toute heure.", en: DEFAULT_GUARDRAIL_MESSAGES.distress.en });
    });

    it("keeps serving the validated message in production while a change waits for validation", async () => {
      const production = storeFor("validated");
      await store.saveMessage(claire, "prompt_injection", "fr", "Version 1");
      await production.validateMessage(paul, "prompt_injection", "fr", 1);
      const changed = await store.saveMessage(claire, "prompt_injection", "fr", "Version 2");

      expect(changed).toMatchObject({ ok: true, before: { version: 1 }, version: { version: 2, validation: null } });
      expect((await production.config.current()).messages.prompt_injection.fr).toBe("Version 1");
      expect((await store.config.current()).messages.prompt_injection.fr).toBe("Version 2");
      expect((await production.list()).find((each) => each.id === "prompt_injection")!.messages.fr).toMatchObject({ latest: { version: 2 }, served: { version: 1 } });
    });

    it("validates only the latest version, once", async () => {
      await store.saveMessage(claire, "harmful_advice", "en", "One");
      await store.saveMessage(claire, "harmful_advice", "en", "Two");

      expect(await store.validateMessage(paul, "harmful_advice", "en", 1)).toEqual({ ok: false, error: "not_latest" });
      expect(await store.validateMessage(paul, "harmful_advice", "en", 3)).toEqual({ ok: false, error: "not_found" });
      expect(await store.validateMessage(paul, "harmful_advice", "fr", 1)).toEqual({ ok: false, error: "not_found" });
      expect((await store.validateMessage(paul, "harmful_advice", "en", 2)).ok).toBe(true);
      expect(await store.validateMessage(paul, "harmful_advice", "en", 2)).toEqual({ ok: false, error: "already_validated" });
    });

    it("refuses an empty, too long or unchanged message, an unknown Guardrail or language", async () => {
      await store.saveMessage(claire, "distress", "fr", "Appelez le 3114.");

      expect(await store.saveMessage(claire, "distress", "fr", "   ")).toEqual({ ok: false, error: "invalid" });
      expect(await store.saveMessage(claire, "distress", "fr", "x".repeat(2_001))).toEqual({ ok: false, error: "invalid" });
      expect(await store.saveMessage(claire, "distress", "fr", "Appelez le 3114.")).toEqual({ ok: false, error: "unchanged" });
      expect(await store.saveMessage(claire, "nope", "fr", "Bonjour")).toEqual({ ok: false, error: "not_found" });
      expect(await store.saveMessage(claire, "distress", "de", "Hallo")).toEqual({ ok: false, error: "not_found" });
    });

    it("refuses a distress message without the 3114 helpline", async () => {
      expect(await store.saveMessage(claire, "distress", "fr", "Courage, ça va aller.")).toEqual({ ok: false, error: "helpline_missing" });
    });
  });

  describe("Guardrail Triggers", () => {
    const at = (iso: string) => new Date(iso);

    it("are counted per day (Paris time) and per Guardrail, with no Candidate, no conversation and no text", async () => {
      await store.triggers.record({ guardrail: "prompt_injection", setting: "block", action: "blocked", agent: "ai_coach", at: at("2026-10-19T08:00:00Z") });
      await store.triggers.record({ guardrail: "prompt_injection", setting: "flag", action: "flagged", agent: "back_office_assistant", at: at("2026-10-19T09:00:00Z") });
      await store.triggers.record({ guardrail: "distress", setting: "block", action: "unavailable", reason: "guardrail_timeout", agent: "ai_coach", at: at("2026-10-19T22:30:00Z") });
      await store.triggers.record({ guardrail: "distress", setting: "block", action: "blocked", agent: "ai_coach", at: at("2026-10-18T12:00:00Z") });

      const days = await store.triggersPerDay(at("2026-10-01T00:00:00Z"));

      expect(days).toEqual([
        { day: "2026-10-20", guardrail: "distress", blocked: 0, flagged: 0, unavailable: 1, unavailableBy: { guardrail_timeout: 1, invalid_verdict: 0, provider_error: 0, unrecorded: 0 } },
        { day: "2026-10-19", guardrail: "prompt_injection", blocked: 1, flagged: 1, unavailable: 0, unavailableBy: { guardrail_timeout: 0, invalid_verdict: 0, provider_error: 0, unrecorded: 0 } },
        { day: "2026-10-18", guardrail: "distress", blocked: 1, flagged: 0, unavailable: 0, unavailableBy: { guardrail_timeout: 0, invalid_verdict: 0, provider_error: 0, unrecorded: 0 } },
      ]);
      const { rows } = await database.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'guardrail_trigger' ORDER BY ordinal_position");
      expect(rows.map((row) => row.column_name)).toEqual(["id", "guardrail", "setting", "action", "agent", "at", "reason"]);
    });

    it("count the checks that could not be made per Failure Reason; one recorded before reasons were is unrecorded", async () => {
      const day = at("2026-10-19T10:00:00Z");
      for (const reason of ["guardrail_timeout", "guardrail_timeout", "invalid_verdict", "provider_error"] as const) {
        await store.triggers.record({ guardrail: "harmful_advice", setting: "block", action: "unavailable", reason, agent: "ai_coach", at: day });
      }
      await database.query("INSERT INTO guardrail_trigger (guardrail, setting, action, agent, at) VALUES ('harmful_advice', 'block', 'unavailable', 'ai_coach', $1)", [day]);

      expect(await store.triggersPerDay(at("2026-10-01T00:00:00Z"))).toEqual([
        { day: "2026-10-19", guardrail: "harmful_advice", blocked: 0, flagged: 0, unavailable: 5, unavailableBy: { guardrail_timeout: 2, invalid_verdict: 1, provider_error: 1, unrecorded: 1 } },
      ]);
    });

    it("keep a reason only for a check that could not be made, and only a Guardrail's Failure Reason code", async () => {
      const insert = (action: string, reason: string) =>
        database.query("INSERT INTO guardrail_trigger (guardrail, setting, action, agent, at, reason) VALUES ('distress', 'block', $1, 'ai_coach', now(), $2)", [action, reason]);

      await expect(insert("blocked", "guardrail_timeout")).rejects.toThrow();
      await expect(insert("unavailable", "Marie a écrit…")).rejects.toThrow();
      await expect(insert("unavailable", "other")).rejects.toThrow();
    });

    it(`are kept ${TRIGGER_RETENTION_MONTHS} months, then purged`, async () => {
      await store.triggers.record({ guardrail: "distress", setting: "block", action: "blocked", agent: "ai_coach", at: at("2024-10-19T10:00:00Z") });
      await store.triggers.record({ guardrail: "distress", setting: "block", action: "blocked", agent: "ai_coach", at: at("2024-10-21T10:00:00Z") });

      expect(await purgeExpiredGuardrailTriggers(database, at("2026-10-20T10:00:00Z"))).toBe(1);
      expect(await purgeExpiredGuardrailTriggers(database, at("2026-10-20T10:00:00Z"))).toBe(0);
      expect(await store.triggersPerDay(at("2020-01-01T00:00:00Z"))).toHaveLength(1);
    });
  });
});
