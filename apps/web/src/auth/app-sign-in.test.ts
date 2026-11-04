import { describe, expect, it } from "vitest";
import { emailedMagicLink, webSignInFromAppLink } from "./app-sign-in";

const BASE = "https://jobbbox.ai";
const verifyLink = (callbackURL: string) => `${BASE}/api/auth/magic-link/verify?token=abc123&callbackURL=${encodeURIComponent(callbackURL)}`;

describe("the link a magic-link email carries", () => {
  it("is the app's web address, the token alone, when the app asked for it", () => {
    expect(emailedMagicLink(verifyLink("jobbbox:///connexion/app"), BASE)).toBe(`${BASE}/connexion/app?token=abc123`);
  });

  it("is Better Auth's own link when the web asked for it", () => {
    expect(emailedMagicLink(verifyLink("/compte"), BASE)).toBe(verifyLink("/compte"));
    expect(emailedMagicLink(verifyLink(`${BASE}/compte`), BASE)).toBe(verifyLink(`${BASE}/compte`));
  });
});

describe("the app's web address, opened in a browser", () => {
  it("signs in on the web with the link's token, landing home or back on sign-in with the error", () => {
    const target = webSignInFromAppLink(new URL(`${BASE}/connexion/app?token=abc123`));

    expect(`${target.origin}${target.pathname}`).toBe(`${BASE}/api/auth/magic-link/verify`);
    expect(Object.fromEntries(target.searchParams)).toEqual({ token: "abc123", callbackURL: "/", errorCallbackURL: "/connexion" });
  });

  it("goes to sign-in without a token", () => {
    expect(webSignInFromAppLink(new URL(`${BASE}/connexion/app`)).toString()).toBe(`${BASE}/connexion`);
  });
});
