import { describe, expect, it } from "vitest";
import { signInHooks } from "./index";
import { BASE_URL, testProvider, testSignIn } from "./test-support";

const sso = testProvider({ id: "jobbbox-sso", type: "oidc", clientId: "jobbbox-web", clientSecret: "secret", discoveryUrl: "https://sso.jobbbox.test/.well-known/openid-configuration", trustedForLinking: false });

/** A callback's endpoint context, as Better Auth hands it to a database hook; `users` is what its adapter finds. */
function callbackContext(users: Record<string, { id: string; email: string; emailVerified: boolean }>) {
  return {
    path: "/callback/:id",
    params: { id: sso.id },
    redirect: (url: string) => new Error(`redirect ${url}`),
    context: { internalAdapter: { findUserById: async (id: string) => users[id] ?? null } },
  };
}

describe("the sign-in hooks", () => {
  it("let a person signing up through an untrusted provider get their first account, whatever context object each hook is given", async () => {
    const hooks = signInHooks(testSignIn([sso]), BASE_URL);
    const users = { "new-id": { id: "new-id", email: "Paul@Example.fr", emailVerified: true } };

    await hooks.user.create.before({ email: "paul@example.fr", emailVerified: true }, callbackContext(users));
    // Better Auth may hand the account hook another context object than the user hook's.
    await expect(hooks.account.create.before({ userId: "new-id" }, callbackContext(users))).resolves.toBeUndefined();
  });

  it("still refuse linking an existing account through an untrusted provider", async () => {
    const hooks = signInHooks(testSignIn([sso]), BASE_URL);
    const users = { "marie-id": { id: "marie-id", email: "marie@example.fr", emailVerified: true } };

    await expect(hooks.account.create.before({ userId: "marie-id" }, callbackContext(users))).rejects.toMatchObject({ body: { code: "account_not_linked" } });
  });

  it("refuse an account whose owner cannot be found, rather than let it through", async () => {
    const hooks = signInHooks(testSignIn([sso]), BASE_URL);

    await expect(hooks.account.create.before({ userId: "nobody" }, callbackContext({}))).rejects.toMatchObject({ body: { code: "account_not_linked" } });
  });

  it("never start a session pending its second step after a Sign-in Provider, whatever the account (ADR-0075)", async () => {
    const hooks = signInHooks(testSignIn([sso]), BASE_URL, async () => true);
    const users = { "marie-id": { id: "marie-id", email: "marie@example.fr", emailVerified: true } };

    const created = await hooks.session.create.before({ userId: "marie-id" }, callbackContext(users));

    expect(created).toEqual({ data: { signInMethod: sso.id } });
  });

  it("start a magic link's session pending when the account has Two-step verification, and only then", async () => {
    const magicLink = { ...callbackContext({}), path: "/magic-link/verify", params: {} };
    const withIt = signInHooks(testSignIn([sso]), BASE_URL, async (id) => id === "marie-id");

    expect(await withIt.session.create.before({ userId: "marie-id" }, magicLink)).toEqual({ data: { signInMethod: "magic-link", twoStepPending: true } });
    expect(await withIt.session.create.before({ userId: "jean-id" }, magicLink)).toEqual({ data: { signInMethod: "magic-link" } });
  });
});
