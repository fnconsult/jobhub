import { describe, expect, it } from "vitest";
import { TEST_BUILD_EXTENSION_ORIGIN } from "@jobhub/shared/extension-test-build";
import { extensionOriginsFromEnv, listedExtensionOrigins, testBuildTrust } from "./extension-origins";

// ADR-0033, amended after the 2026-11-13 regression: the test zip's id is fixed and its key public. Outside Production the
// web app trusts its origin without any .env change; Production trusts only what EXTENSION_ORIGINS lists.
const STORE = "chrome-extension://storelistingid";

describe("the extension origins the web app trusts", () => {
  it("reads EXTENSION_ORIGINS comma-separated, trimmed, empty entries dropped", () => {
    expect(listedExtensionOrigins({ EXTENSION_ORIGINS: ` ${STORE} , ,chrome-extension://other ` })).toEqual([STORE, "chrome-extension://other"]);
    expect(listedExtensionOrigins({})).toEqual([]);
  });

  describe("in Production", () => {
    for (const env of [
      { JOBHUB_TARGET: "production", NODE_ENV: "production" },
      // A production build that names no target is held to Production's rules, as Nouveautés and the Playbooks read it.
      { NODE_ENV: "production" },
      // So is JOBHUB_TARGET=production whatever NODE_ENV says.
      { JOBHUB_TARGET: " production ", NODE_ENV: "development" },
    ]) {
      it(`stays strict: only the listed origins (${JSON.stringify(env)})`, () => {
        expect(extensionOriginsFromEnv({ ...env, EXTENSION_ORIGINS: STORE })).toEqual([STORE]);
        expect(testBuildTrust({ ...env, EXTENSION_ORIGINS: STORE })).toBe("not_recognised");
        expect(extensionOriginsFromEnv(env)).toEqual([]);
        expect(testBuildTrust(env)).toBe("not_recognised");
      });
    }

    it("trusts the test zip only when EXTENSION_ORIGINS lists it on purpose", () => {
      const env = { JOBHUB_TARGET: "production", NODE_ENV: "production", EXTENSION_ORIGINS: `${STORE},${TEST_BUILD_EXTENSION_ORIGIN}` };
      expect(extensionOriginsFromEnv(env)).toEqual([STORE, TEST_BUILD_EXTENSION_ORIGIN]);
      expect(testBuildTrust(env)).toBe("listed");
    });
  });

  describe("outside Production", () => {
    for (const env of [{ JOBHUB_TARGET: "staging", NODE_ENV: "production" }, { JOBHUB_TARGET: "e2e", NODE_ENV: "production" }, { NODE_ENV: "development" }, {}]) {
      it(`trusts the test zip automatically, beside the listed origins (${JSON.stringify(env)})`, () => {
        expect(extensionOriginsFromEnv({ ...env, EXTENSION_ORIGINS: STORE })).toEqual([STORE, TEST_BUILD_EXTENSION_ORIGIN]);
        expect(testBuildTrust({ ...env, EXTENSION_ORIGINS: STORE })).toBe("automatic");
        expect(extensionOriginsFromEnv(env)).toEqual([TEST_BUILD_EXTENSION_ORIGIN]);
      });
    }

    it("says « listed », not « automatic », when EXTENSION_ORIGINS already names it, and never trusts it twice", () => {
      const env = { JOBHUB_TARGET: "staging", EXTENSION_ORIGINS: TEST_BUILD_EXTENSION_ORIGIN };
      expect(testBuildTrust(env)).toBe("listed");
      expect(extensionOriginsFromEnv(env)).toEqual([TEST_BUILD_EXTENSION_ORIGIN]);
    });

    it("trusts no other unlisted extension", () => {
      expect(extensionOriginsFromEnv({ JOBHUB_TARGET: "staging" })).not.toContain("chrome-extension://someoneelse");
    });
  });
});
