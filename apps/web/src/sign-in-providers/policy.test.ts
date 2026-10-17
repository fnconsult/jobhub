import { describe, expect, it } from "vitest";
import { betterAuthSignIn, linkableProviders, needsSsoForBackOffice, oauthSignInDecision, signInButtons, trustedProviderIds } from "./policy";
import type { SignInConfiguration, SignInProvider } from "./catalog";

const provider = (overrides: Partial<SignInProvider> & Pick<SignInProvider, "id" | "type">): SignInProvider => ({
  displayName: overrides.id,
  clientId: `${overrides.id}-client`,
  clientSecret: `${overrides.id}-secret`,
  enabled: true,
  shownToCandidates: true,
  allowedForAdministrators: true,
  trustedForLinking: true,
  ...overrides,
});

const configuration = (providers: SignInProvider[], requireSsoForAdministrators = false): SignInConfiguration => ({
  providers,
  requireSsoForAdministrators,
  version: "test",
});

const google = provider({ id: "google", type: "google", displayName: "Google" });
const staffOidc = provider({
  id: "jobbbox-sso",
  type: "oidc",
  displayName: "Jobbbox SSO",
  discoveryUrl: "https://sso.jobbbox.fr/.well-known/openid-configuration",
  discovery: { issuer: "https://sso.jobbbox.fr", authorization_endpoint: "https://sso.jobbbox.fr/authorize" },
  shownToCandidates: false,
  trustedForLinking: false,
});
const draftApple = provider({ id: "apple", type: "apple", displayName: "Apple", enabled: false });

describe("the sign-in buttons", () => {
  const providers = configuration([google, staffOidc, draftApple]);

  it("shows Candidates the enabled providers shown to them", () => {
    expect(signInButtons(providers, "candidates")).toEqual([{ id: "google", displayName: "Google" }]);
  });

  it("shows the Back Office sign-in every enabled provider allowed for Administrators", () => {
    expect(signInButtons(providers, "administrators")).toEqual([
      { id: "google", displayName: "Google" },
      { id: "jobbbox-sso", displayName: "Jobbbox SSO" },
    ]);
  });

  it("never carries a client secret", () => {
    expect(JSON.stringify(signInButtons(providers, "administrators"))).not.toContain("secret");
  });
});

describe("the providers a person may link from Mon compte", () => {
  const providers = configuration([google, staffOidc, draftApple]);

  it("are those shown to Candidates, for a Candidate", () => {
    expect(linkableProviders(providers, { isAdministrator: false })).toEqual([{ id: "google", displayName: "Google" }]);
  });

  it("add those allowed for Administrators, for an Administrator, each once", () => {
    expect(linkableProviders(providers, { isAdministrator: true })).toEqual([
      { id: "google", displayName: "Google" },
      { id: "jobbbox-sso", displayName: "Jobbbox SSO" },
    ]);
  });
});

describe("an OAuth sign-in through a provider", () => {
  const providers = configuration([google, staffOidc, draftApple]);

  it("is allowed for anyone when the provider is shown to Candidates", () => {
    expect(oauthSignInDecision(providers, "google", { isAdministrator: false })).toBe("allow");
  });

  it("is allowed for Administrators only when the provider is not shown to Candidates", () => {
    expect(oauthSignInDecision(providers, "jobbbox-sso", { isAdministrator: true })).toBe("allow");
    expect(oauthSignInDecision(providers, "jobbbox-sso", { isAdministrator: false })).toBe("refuse");
  });

  it("is a test sign-in, signing nobody in, while the provider is not enabled", () => {
    expect(oauthSignInDecision(providers, "apple", { isAdministrator: true })).toBe("test");
  });

  it("is refused through a provider that is not configured", () => {
    expect(oauthSignInDecision(providers, "github", { isAdministrator: true })).toBe("refuse");
  });
});

describe("providers trusted for linking", () => {
  it("are the enabled ones trusted for linking", () => {
    expect(trustedProviderIds(configuration([google, staffOidc, { ...draftApple }]))).toEqual(["google"]);
  });

  it("leave out Microsoft on a multi-tenant directory, where any tenant may claim an email address", () => {
    const common = provider({ id: "microsoft", type: "microsoft", tenantId: "common" });
    const organizations = provider({ id: "microsoft", type: "microsoft", tenantId: "organizations" });
    const consumers = provider({ id: "microsoft", type: "microsoft", tenantId: "consumers" });
    const oneTenant = provider({ id: "microsoft", type: "microsoft", tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad" });

    expect(trustedProviderIds(configuration([common]))).toEqual([]);
    expect(trustedProviderIds(configuration([organizations]))).toEqual([]);
    expect(trustedProviderIds(configuration([consumers]))).toEqual(["microsoft"]);
    expect(trustedProviderIds(configuration([oneTenant]))).toEqual(["microsoft"]);
  });
});

describe("Require SSO for Administrators", () => {
  const on = configuration([google, staffOidc], true);
  const off = configuration([google, staffOidc], false);

  it("asks an Administrator signed in by magic link to sign in again", () => {
    expect(needsSsoForBackOffice(on, { signInMethod: "magic-link", permanentSuperAdmin: false })).toBe(true);
  });

  it("asks it of a session whose sign-in method is unknown (signed in before the setting existed)", () => {
    expect(needsSsoForBackOffice(on, { signInMethod: null, permanentSuperAdmin: false })).toBe(true);
  });

  it("lets through an Administrator signed in with a provider allowed for Administrators", () => {
    expect(needsSsoForBackOffice(on, { signInMethod: "jobbbox-sso", permanentSuperAdmin: false })).toBe(false);
  });

  it("never asks it of an ADMIN_EMAILS super-admin", () => {
    expect(needsSsoForBackOffice(on, { signInMethod: "magic-link", permanentSuperAdmin: true })).toBe(false);
  });

  it("asks nothing while the setting is off", () => {
    expect(needsSsoForBackOffice(off, { signInMethod: "magic-link", permanentSuperAdmin: false })).toBe(false);
  });
});

describe("the Better Auth configuration", () => {
  const microsoft = provider({ id: "microsoft", type: "microsoft", tenantId: "consumers" });
  const apple = provider({ id: "apple", type: "apple", appBundleIdentifier: "fr.jobbbox.app" });

  it("registers Google, Apple and Microsoft as social providers, and OIDC ones through generic OAuth", () => {
    const built = betterAuthSignIn(configuration([google, microsoft, apple, staffOidc]));

    expect(built.socialProviders).toEqual({
      google: { clientId: "google-client", clientSecret: "google-secret" },
      microsoft: { clientId: "microsoft-client", clientSecret: "microsoft-secret", tenantId: "consumers" },
      apple: { clientId: "apple-client", clientSecret: "apple-secret", appBundleIdentifier: "fr.jobbbox.app" },
    });
    expect(built.genericOAuth).toEqual([
      expect.objectContaining({
        providerId: "jobbbox-sso",
        name: "Jobbbox SSO",
        clientId: "jobbbox-sso-client",
        clientSecret: "jobbbox-sso-secret",
        discoveryUrl: "https://sso.jobbbox.fr/.well-known/openid-configuration",
      }),
    ]);
  });

  it("leaves out an OIDC provider whose discovery document could not be fetched in time when the configuration was read", () => {
    expect(betterAuthSignIn(configuration([{ ...staffOidc, discovery: undefined }])).genericOAuth).toEqual([]);
  });

  it("registers a provider not enabled only while a test sign-in started from Connexion is pending", () => {
    expect(Object.keys(betterAuthSignIn(configuration([draftApple])).socialProviders)).toEqual([]);
    expect(Object.keys(betterAuthSignIn(configuration([{ ...draftApple, testPending: true }])).socialProviders)).toEqual(["apple"]);
    expect(betterAuthSignIn(configuration([{ ...staffOidc, enabled: false }])).genericOAuth).toEqual([]);
  });

  it("trusts Apple's form post origin only while Apple is configured", () => {
    expect(betterAuthSignIn(configuration([google, apple])).trustedOrigins).toEqual(["https://appleid.apple.com"]);
    expect(betterAuthSignIn(configuration([google])).trustedOrigins).toEqual([]);
  });
});
