import { TEST_BUILD_EXTENSION_ORIGIN } from "@jobhub/shared/extension-test-build";

type Env = Record<string, string | undefined>;

/** EXTENSION_ORIGINS, comma-separated: the `chrome-extension://<id>` origins this deployment's .env lists, and only those. */
export function listedExtensionOrigins(env: Env = process.env): string[] {
  return (env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Whether this deployment is Production, as Nouveautés, the Legal Text notices and the Playbooks' serving read it
 * (ADR-0021, ADR-0063): JOBHUB_TARGET=production, or a production build that names no target, so a deployment that
 * forgets to say where it runs is held to Production's rules.
 */
function isProduction(env: Env): boolean {
  const target = env.JOBHUB_TARGET?.trim();
  return target ? target === "production" : env.NODE_ENV === "production";
}

/**
 * Why this deployment trusts the test zip's fixed origin, or does not (ADR-0033, amended for the 2026-11-13
 * regression): « listed » when EXTENSION_ORIGINS names it, « automatic » outside Production, « not_recognised » in
 * Production when EXTENSION_ORIGINS does not name it. The test key is public: anyone can build an extension with that
 * id, so Production trusts it only when it is listed on purpose.
 */
export type TestBuildTrust = "listed" | "automatic" | "not_recognised";

export function testBuildTrust(env: Env = process.env): TestBuildTrust {
  if (listedExtensionOrigins(env).includes(TEST_BUILD_EXTENSION_ORIGIN)) return "listed";
  return isProduction(env) ? "not_recognised" : "automatic";
}

/**
 * The `chrome-extension://<id>` origins of our extension builds the web app trusts: those EXTENSION_ORIGINS lists, and,
 * outside Production, the test zip's (testBuildTrust). Every reader goes through this list: Better Auth's
 * trustedOrigins, hence isFromTrustedOrigin (Captures, Extension Events and every other state-changing route).
 */
export function extensionOriginsFromEnv(env: Env = process.env): string[] {
  const listed = listedExtensionOrigins(env);
  return testBuildTrust(env) === "automatic" ? [...listed, TEST_BUILD_EXTENSION_ORIGIN] : listed;
}
