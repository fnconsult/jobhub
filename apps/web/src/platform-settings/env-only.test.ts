import { describe, expect, it } from "vitest";
import { envOnlySettingsShown, retiredSettingsSet } from "./env-only";

const AUTH_SECRET = "a-very-secret-session-signing-key-0123456789";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const OLD_MASTER_KEY = Buffer.alloc(32, 3).toString("base64");
const ENV = {
  DATABASE_URL: "postgres://jobhub:s3cr3t-db-pass@db.internal:5432/jobhub?sslmode=require&password=again-s3cr3t",
  AUTH_SECRET,
  SECRETS_MASTER_KEYS: `1:${OLD_MASTER_KEY},2:${MASTER_KEY}`,
  APP_URL: "https://staging.jobbbox.ai",
  ADMIN_EMAILS: "ops@jobbbox.ai",
  JOBHUB_TARGET: "staging",
  MAIL_TRANSPORT: "console",
  STRIPE_PRICE_STANDARD: "price_standard",
  OPENAI_API_KEY: "sk-openai-never-shown",
  NODE_ENV: "production",
};

const shown = (env: Record<string, string | undefined>) => Object.fromEntries(envOnlySettingsShown(env).map((row) => [row.name, row]));

describe("the settings only env holds, as Paramètres shows them", () => {
  it("lists the bootstrap settings, MAIL_TRANSPORT and the Stripe Prices, and nothing else env holds", () => {
    expect(envOnlySettingsShown(ENV).map((row) => row.name)).toEqual([
      "DATABASE_URL",
      "AUTH_SECRET",
      "SECRETS_MASTER_KEYS",
      "APP_URL",
      "ADMIN_EMAILS",
      "JOBHUB_TARGET",
      "AI_FAKE",
      "MAIL_TRANSPORT",
      "STRIPE_PRICE_STANDARD",
      "STRIPE_PRICE_PREMIUM",
      "STRIPE_PRICE_COACHING_SESSION",
      "STRIPE_PRICE_COACHING_SESSION_PREMIUM",
    ]);
  });

  it("never shows a secret: DATABASE_URL without its password, AUTH_SECRET as set, the master keys by version only", () => {
    const rows = shown(ENV);
    expect(rows.DATABASE_URL?.shown).toEqual({ kind: "value", value: "postgres://jobhub@db.internal:5432/jobhub?sslmode=require" });
    expect(rows.AUTH_SECRET?.shown).toEqual({ kind: "set" });
    expect(rows.SECRETS_MASTER_KEYS?.shown).toEqual({ kind: "key_versions", versions: [1, 2] });
    const everything = JSON.stringify(envOnlySettingsShown(ENV));
    for (const secret of ["s3cr3t-db-pass", "again-s3cr3t", AUTH_SECRET, MASTER_KEY, OLD_MASTER_KEY, "sk-openai-never-shown"]) expect(everything).not.toContain(secret);
  });

  it("says what is missing, and a master key list or database URL it cannot read without showing it", () => {
    const rows = shown({ DATABASE_URL: "not a url with pass word", SECRETS_MASTER_KEYS: "1:too-short-key" });
    expect(rows.AUTH_SECRET?.shown).toEqual({ kind: "missing" });
    expect(rows.APP_URL?.shown).toEqual({ kind: "missing" });
    expect(rows.SECRETS_MASTER_KEYS?.shown).toEqual({ kind: "unreadable" });
    expect(rows.DATABASE_URL?.shown).toEqual({ kind: "unreadable" });
    expect(JSON.stringify(rows)).not.toContain("too-short-key");
  });

  it("shows the other values as env holds them", () => {
    const rows = shown(ENV);
    expect(rows.APP_URL?.shown).toEqual({ kind: "value", value: "https://staging.jobbbox.ai" });
    expect(rows.JOBHUB_TARGET?.shown).toEqual({ kind: "value", value: "staging" });
    expect(rows.STRIPE_PRICE_STANDARD?.shown).toEqual({ kind: "value", value: "price_standard" });
  });

  it("warns when emails are only written to the server log outside e2e", () => {
    expect(shown(ENV).MAIL_TRANSPORT?.warning).toBe("mail_to_console");
    expect(shown({ ...ENV, JOBHUB_TARGET: "e2e" }).MAIL_TRANSPORT?.warning).toBeNull();
    expect(shown({ ...ENV, MAIL_TRANSPORT: undefined }).MAIL_TRANSPORT?.warning).toBeNull();
    expect(shown(ENV).APP_URL?.warning).toBeNull();
  });
});

describe("the env variables Jobbbox no longer reads (#396)", () => {
  it("lists those env still sets, with what took their place, never their value", () => {
    expect(retiredSettingsSet({ ...ENV, COACH_KNOWLEDGE_ENVIRONMENT: "production" })).toEqual([{ name: "COACH_KNOWLEDGE_ENVIRONMENT", replacedBy: "coaching_playbooks" }]);
    expect(retiredSettingsSet({ ...ENV, COACH_KNOWLEDGE_ENVIRONMENT: " " })).toEqual([]);
    expect(retiredSettingsSet(ENV)).toEqual([]);
  });
});
