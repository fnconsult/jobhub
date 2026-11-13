/**
 * The guard on the Platform Settings (#298, ADR-0033): every environment variable the code
 * reads is a Platform Setting, a Provider Secret, or marked as one only env holds. A
 * variable added to the code without saying which fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { AI_ENV_KEYS } from "@jobhub/ai";
import { describe, expect, it } from "vitest";
import { PROVIDER_SECRET_NAMES } from "../provider-secrets/catalog";
import { ENV_ONLY_SETTINGS, PLATFORM_SETTINGS, RETIRED_SETTINGS } from "./catalog";

const ROOT = new URL("../../../../", import.meta.url).pathname;

/**
 * Workspaces neither the web app nor the worker runs: their variables are no Platform Setting. The motions' tooling (#567)
 * runs in its own GitHub workflow, on that workflow's secrets and variables (docs/ops/motions.md). The Jobbbox app (#704)
 * runs on the phone: EAS bakes its `EXPO_PUBLIC_*` variables into the bundle at build time, per profile in apps/mobile/eas.json
 * (docs/ops/mobile.md, ADR-0076), so no server env and no Back Office can set them.
 */
const NOT_THE_APP = new Set(["packages/motions", "apps/mobile"]);

/** Every source file of the apps and packages, tests left out. */
function sourceFiles(): string[] {
  return ["apps", "packages"].flatMap((top) =>
    readdirSync(join(ROOT, top))
      .filter((workspace) => !NOT_THE_APP.has(`${top}/${workspace}`))
      .flatMap((workspace) => {
        const src = join(ROOT, top, workspace, "src");
        try {
          return (readdirSync(src, { recursive: true }) as string[])
            .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("node_modules"))
            .map((file) => join(src, file));
        } catch {
          return [];
        }
      }),
  );
}

const NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{2,}";

/**
 * The environment variables a source reads: `env.NAME`, `process.env.NAME`, `env["NAME"]`, and, in
 * a file that reads env, every quoted name shaped like one (`required("AUTH_SECRET", …)`,
 * `readNumberSetting(env, "JOB_DIGEST_TARGET_COUNT")`, a table of Price variables).
 */
function envNamesIn(source: string): string[] {
  const read = [...source.matchAll(new RegExp(`\\benv\\??\\.(${NAME})\\b|\\benv\\[\\s*"(${NAME})"\\s*\\]`, "g"))].map((match) => match[1] ?? match[2]!);
  if (!/\bprocess\.env\b|\benv\b/.test(source)) return [...new Set(read)];
  const quoted = [...source.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)].map((match) => match[1]!);
  return [...new Set([...read, ...quoted])];
}

describe("the guard on the Platform Settings", () => {
  it("reads the variables a file reads, and nothing from a file that reads none", () => {
    expect(envNamesIn(`const a = process.env.APP_URL; const b = env?.MAIL_FROM; const c = env["AI_FAKE"]; required("AUTH_SECRET", "x");`).sort()).toEqual(
      ["AI_FAKE", "APP_URL", "AUTH_SECRET", "MAIL_FROM"],
    );
    expect(envNamesIn(`const code = "INVALID_TOKEN";`)).toEqual([]);
  });

  it("finds every variable the code reads among the Platform Settings, the Provider Secrets and the settings only env holds", () => {
    const known = new Set<string>([...PLATFORM_SETTINGS.map((setting) => setting.name), ...PROVIDER_SECRET_NAMES, ...Object.keys(ENV_ONLY_SETTINGS)]);
    const found = sourceFiles().flatMap((file) => envNamesIn(readFileSync(file, "utf8")).map((name) => ({ name, file: relative(ROOT, file) })));
    // The scan sees today's reads: the bootstrap settings, a Platform Setting read through a helper, the AI layer's keys.
    expect(found.map(({ name }) => name)).toEqual(expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "SECRETS_MASTER_KEYS", "JOB_DIGEST_TARGET_COUNT", "STRIPE_PRICE_STANDARD", "MISTRAL_API_KEY"]));
    const unknown = [...found, ...AI_ENV_KEYS.map((name) => ({ name, file: "packages/ai/src/env.ts (AI_ENV_KEYS)" }))].filter(({ name }) => !known.has(name));
    expect(unknown).toEqual([]);
  });

  it("leaves out only workspaces that neither the web app nor the worker imports (the motions' tooling, the Jobbbox app)", () => {
    for (const app of ["apps/web", "apps/worker"]) {
      const manifest = JSON.parse(readFileSync(join(ROOT, app, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@jobhub/motions");
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@jobhub/mobile");
    }
    expect(sourceFiles().some((file) => file.includes("/packages/motions/"))).toBe(false);
    expect(sourceFiles().some((file) => file.includes("/apps/mobile/"))).toBe(false);
  });

  it("lists the native app's crash report DSN among the settings only env holds, shown nowhere (#703)", () => {
    expect(ENV_ONLY_SETTINGS).toMatchObject({ EXPO_PUBLIC_SENTRY_DSN: { kind: "deployment", shown: false } });
  });

  it("reads none of the variables it lists as no longer read, which are nothing else either (#396)", () => {
    const retired = Object.keys(RETIRED_SETTINGS);
    expect(retired.length).toBeGreaterThan(0);
    const read = new Set([...sourceFiles().flatMap((file) => envNamesIn(readFileSync(file, "utf8"))), ...AI_ENV_KEYS]);
    expect(retired.filter((name) => read.has(name))).toEqual([]);
    const known = new Set<string>([...PLATFORM_SETTINGS.map((setting) => setting.name), ...PROVIDER_SECRET_NAMES, ...Object.keys(ENV_ONLY_SETTINGS)]);
    expect(retired.filter((name) => known.has(name))).toEqual([]);
  });

  it("never marks a Platform Setting as one only env holds", () => {
    expect(PLATFORM_SETTINGS.filter((setting) => setting.name in ENV_ONLY_SETTINGS)).toEqual([]);
  });

  it("shows on Paramètres every bootstrap and read-only setting ADR-0033 lists", () => {
    const shown = Object.entries(ENV_ONLY_SETTINGS).flatMap(([name, setting]) => (setting.shown ? [name] : []));
    expect(shown.sort()).toEqual(
      [
        "DATABASE_URL",
        "AUTH_SECRET",
        "SECRETS_MASTER_KEYS",
        "APP_URL",
        "ADMIN_EMAILS",
        "JOBHUB_TARGET",
        "AI_FAKE",
        "MAIL_TRANSPORT",
        // The store review's sign-in code (#981): whether it is on, for whom; the code only set or missing.
        "REVIEW_SIGN_IN",
        "REVIEW_SIGN_IN_EMAILS",
        "REVIEW_SIGN_IN_CODE",
        "EXTENSION_ORIGINS",
        "STRIPE_PRICE_STANDARD",
        "STRIPE_PRICE_PREMIUM",
        "STRIPE_PRICE_COACHING_SESSION",
        "STRIPE_PRICE_COACHING_SESSION_PREMIUM",
      ].sort(),
    );
  });
});
