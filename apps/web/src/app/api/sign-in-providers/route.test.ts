import { signInProvidersResponseSchema } from "@jobhub/shared/sign-in-providers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignInConfiguration, SignInProvider } from "@/sign-in-providers/catalog";
import { GET } from "./route";

const configuration = vi.hoisted(() => ({ current: null as SignInConfiguration | null }));
vi.mock("@/sign-in-providers/server", () => ({ currentSignInConfiguration: () => configuration.current }));

const provider = (overrides: Partial<SignInProvider> & Pick<SignInProvider, "id" | "type" | "displayName">): SignInProvider => ({
  clientId: `${overrides.id}-client`,
  clientSecret: `${overrides.id}-secret`,
  enabled: true,
  shownToCandidates: true,
  allowedForAdministrators: true,
  trustedForLinking: true,
  ...overrides,
});

describe("GET /api/sign-in-providers (#687)", () => {
  beforeEach(() => {
    configuration.current = {
      providers: [
        provider({ id: "google", type: "google", displayName: "Google" }),
        provider({ id: "apple", type: "apple", displayName: "Apple", appBundleIdentifier: "ai.jobbbox.app" }),
        provider({ id: "microsoft", type: "microsoft", displayName: "Microsoft", enabled: false, testPending: true }),
        provider({ id: "jobbbox-sso", type: "oidc", displayName: "Jobbbox SSO", shownToCandidates: false }),
      ],
      requireSsoForAdministrators: false,
      version: "test",
    };
  });

  it("answers the Sign-in Providers the web's sign-in page shows Candidates, in their order: enabled, shown to Candidates", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(signInProvidersResponseSchema.parse(await response.json())).toEqual({
      providers: [
        { id: "google", displayName: "Google" },
        { id: "apple", displayName: "Apple" },
      ],
    });
  });

  it("says nothing of a provider but its id and name: no client id, no secret, no setting", async () => {
    const text = await GET().text();

    expect(text).not.toMatch(/client|secret|ai\.jobbbox\.app/);
  });

  it("is never kept by a cache: a provider switched off in Connexion leaves the app's screen at its next read", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });

  it("answers no provider when only the magic link is offered", async () => {
    configuration.current = { providers: [], requireSsoForAdministrators: false, version: "none" };

    expect(await GET().json()).toEqual({ providers: [] });
  });
});
