import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretResolver, type StoredSecrets } from "../provider-secrets/resolver";
import { contactEnrichmentFromEnv, contactEnrichmentFromSecrets } from "./config";

describe("contact enrichment configuration", () => {
  it("is disabled when no provider is configured", () => {
    expect(contactEnrichmentFromEnv({})).toEqual({ provider: null, disabledBecause: "no_provider" });
  });

  it("is disabled while the provider's DPA is not confirmed signed, even with its key", () => {
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "key" })).toEqual({ provider: null, disabledBecause: "dpa_not_signed" });
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "no" })).toMatchObject({ provider: null });
  });

  it.each([
    ["lusha", "LUSHA_API_KEY"],
    ["kaspr", "KASPR_API_KEY"],
    ["apollo", "APOLLO_API_KEY"],
  ] as const)("selects %s, with its key, once its DPA is confirmed signed", (name, keyVariable) => {
    const config = contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: name, [keyVariable]: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" });
    expect(config.provider?.id).toBe(name);
  });

  it("refuses an unknown provider, or a chosen one without its key", () => {
    expect(() => contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "clearbit", CONTACT_ENRICHMENT_DPA_SIGNED: "true" })).toThrow(/CONTACT_ENRICHMENT_PROVIDER/);
    expect(() => contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "lusha", CONTACT_ENRICHMENT_DPA_SIGNED: "true" })).toThrow(/LUSHA_API_KEY/);
  });
});

describe("contact enrichment on Provider Secrets (#208)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a call refused with the key in use is made once more with the key just replaced in the Back Office", async () => {
    const stored = { current: { LUSHA_API_KEY: { value: "lusha-revoked", row: "r1" } } as StoredSecrets };
    const resolver = createSecretResolver({ load: async () => stored.current, env: { CONTACT_ENRICHMENT_PROVIDER: "lusha", CONTACT_ENRICHMENT_DPA_SIGNED: "true" } });
    await resolver.refresh();
    const keysSent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      keysSent.push(init.headers.api_key!);
      if (init.headers.api_key === "lusha-revoked") return new Response("{}", { status: 401 });
      return Response.json({ results: [{ id: "lusha-1", firstName: "Claire", lastName: "Martin", jobTitle: { title: "DRH" } }] });
    });
    const config = contactEnrichmentFromSecrets(resolver);
    stored.current = { LUSHA_API_KEY: { value: "lusha-fresh", row: "r2" } };

    const people = await config.provider!.findPeople!({ companyName: "Acme", jobTitles: ["DRH"], limit: 10 });

    expect(people.map((person) => person.name)).toEqual(["Claire Martin"]);
    expect(keysSent).toEqual(["lusha-revoked", "lusha-fresh"]);
    expect(config.provider!.id).toBe("lusha");
  });

  it("is off, as from env, without a provider", () => {
    const resolver = createSecretResolver({ load: async () => ({}), env: {} });

    expect(contactEnrichmentFromSecrets(resolver)).toEqual({ provider: null, disabledBecause: "no_provider" });
  });
});
