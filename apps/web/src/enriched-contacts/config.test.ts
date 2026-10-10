import { describe, expect, it } from "vitest";
import { contactEnrichmentFromEnv } from "./config";

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
