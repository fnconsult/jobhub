import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "./test-support";

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe.skipIf(!connectionString)("session shared with the browser extension (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth({ extensionOrigins: [EXTENSION_ORIGIN] });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("lets the extension read the Candidate signed in on the web app", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

    const response = await testAuth.request("/api/auth/get-session", { cookie, origin: EXTENSION_ORIGIN });

    expect((await response.json()).user).toMatchObject({ email: "marie.dupont@example.fr", interfaceLanguage: "fr" });
  });

  it("lets the extension act for the Candidate", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

    const response = await testAuth.request("/api/auth/sign-out", { cookie, origin: EXTENSION_ORIGIN, body: {} });

    expect(response.status).toBe(200);
  });

  it("refuses actions from an extension it does not know", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

    const response = await testAuth.request("/api/auth/sign-out", {
      cookie,
      origin: "chrome-extension://someoneelsesextensionidxxxxxxxxx",
      body: {},
    });

    expect(response.status).toBe(403);
  });
});
