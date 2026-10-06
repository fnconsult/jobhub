import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, linkIn, signInWithMagicLink, startTestAuth, type TestAuth } from "./test-support";

describe.skipIf(!connectionString)("Candidate accounts (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("signs a new person up as a Candidate through a magic link, in French by default", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

    const session = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    expect(session.user).toMatchObject({ email: "marie.dupont@example.fr", interfaceLanguage: "fr" });
  });

  it("signs a returning Candidate into the same account", async () => {
    const first = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const second = await signInWithMagicLink(testAuth, "Marie.Dupont@example.fr");

    const [a, b] = await Promise.all(
      [first, second].map(async (cookie) => (await testAuth.request("/api/auth/get-session", { cookie })).json()),
    );
    expect(b.user.id).toBe(a.user.id);
  });

  it("emails a French sign-in link that works only once", async () => {
    await testAuth.request("/api/auth/sign-in/magic-link", { body: { email: "marie.dupont@example.fr" } });
    const [email] = testAuth.mailbox;
    expect(email).toMatchObject({ to: "marie.dupont@example.fr", subject: "Votre lien de connexion à Jobbbox" });

    const firstUse = await testAuth.request(linkIn(email));
    const secondUse = await testAuth.request(linkIn(email));
    expect(firstUse.headers.getSetCookie().join()).toContain("session_token");
    expect(secondUse.headers.getSetCookie().join()).not.toContain("session_token");
  });

  describe("Interface Language", () => {
    async function interfaceLanguageOf(cookie: string) {
      const session = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
      return session.user.interfaceLanguage;
    }

    it("can be switched to English by the Candidate", async () => {
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

      const updated = await testAuth.request("/api/auth/update-user", { cookie, body: { interfaceLanguage: "en" } });

      expect(updated.status).toBe(200);
      expect(await interfaceLanguageOf(cookie)).toBe("en");
    });

    it("refuses a language the interface is not translated into", async () => {
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

      const updated = await testAuth.request("/api/auth/update-user", { cookie, body: { interfaceLanguage: "de" } });

      expect(updated.status).toBe(400);
      expect(await interfaceLanguageOf(cookie)).toBe("fr");
    });

    it("is the language of the Candidate's sign-in emails", async () => {
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      await testAuth.request("/api/auth/update-user", { cookie, body: { interfaceLanguage: "en" } });

      await testAuth.request("/api/auth/sign-in/magic-link", { body: { email: "marie.dupont@example.fr" } });

      expect(testAuth.mailbox.at(-1)?.subject).toBe("Your Jobbbox sign-in link");
    });
  });
});
