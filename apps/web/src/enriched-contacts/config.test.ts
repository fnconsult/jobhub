import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretResolver, type StoredSecrets } from "../provider-secrets/resolver";
import type { ExternalApiCall } from "@jobhub/shared";
import { contactEnrichmentFromEnv, contactEnrichmentFromSecrets } from "./config";

describe("contact enrichment configuration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records each call to the provider as an external API call, with its credit cost and never the key (#218)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ person: { id: "p1", email: "marie@acme.example" } })));
    const calls: ExternalApiCall[] = [];
    const config = contactEnrichmentFromEnv(
      { CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "apollo-key-0123456789", CONTACT_ENRICHMENT_DPA_SIGNED: "true" },
      { externalApis: { record: (call) => void calls.push(call) } },
    );

    await config.provider!.getContactDetails({ providerPersonId: "p1" });

    expect(calls).toEqual([expect.objectContaining({ provider: "apollo", operation: "POST /api/v1/people/match", ok: true, httpStatus: 200, costEur: expect.closeTo(0.2 * 0.86, 9) })]);
    expect(JSON.stringify(calls)).not.toMatch(/apollo-key|marie/);
  });

  it("is disabled when no provider is configured", () => {
    expect(contactEnrichmentFromEnv({})).toEqual({ provider: null, disabledBecause: "no_provider" });
  });

  it("is disabled while the provider's DPA is not confirmed signed, even with its key", () => {
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "key" })).toEqual({ provider: null, disabledBecause: "dpa_not_signed" });
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "no" })).toMatchObject({ provider: null });
  });

  it("is off while the DPA is not confirmed signed, whatever the provider and key: none chosen, one without its key (ADR-0015, #302)", () => {
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "lusha" })).toEqual({ provider: null, disabledBecause: "dpa_not_signed" });
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "none", CONTACT_ENRICHMENT_DPA_SIGNED: "true" })).toEqual({ provider: null, disabledBecause: "no_provider" });
  });

  it("is off, not failing, once the DPA is signed for a provider whose key is not in Clés yet (#302)", () => {
    expect(contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "kaspr", CONTACT_ENRICHMENT_DPA_SIGNED: "true", LUSHA_API_KEY: "key" })).toEqual({ provider: null, disabledBecause: "no_key" });
  });

  it.each([
    ["lusha", "LUSHA_API_KEY"],
    ["kaspr", "KASPR_API_KEY"],
    ["apollo", "APOLLO_API_KEY"],
  ] as const)("selects %s, with its key, once its DPA is confirmed signed", (name, keyVariable) => {
    const config = contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: name, [keyVariable]: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" });
    expect(config.provider?.id).toBe(name);
  });

  it("refuses an unknown provider", () => {
    expect(() => contactEnrichmentFromEnv({ CONTACT_ENRICHMENT_PROVIDER: "clearbit", CONTACT_ENRICHMENT_DPA_SIGNED: "true" })).toThrow(/CONTACT_ENRICHMENT_PROVIDER/);
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
