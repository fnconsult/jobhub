import { describe, expect, it } from "vitest";
import { parseSetting, PLATFORM_SETTINGS, platformSetting } from "./catalog";

/** Every Platform Setting ADR-0033 lists, by name. */
const ADR_0033 = [
  "ANTHROPIC_ENDPOINT",
  "BEDROCK_REGION",
  "VERTEX_REGION",
  "VERTEX_PROJECT_ID",
  "OPENAI_DATA_RESIDENCY",
  ...["SCORING", "WRITING", "COACHING", "BACK_OFFICE_ASSISTANT", "GUARDRAIL", "EVAL", "CV_PARSING", "OFFER_ANALYSIS", "JOB_TITLES", "WEB_SEARCH"].flatMap((task) => [
    `AI_${task}_PROVIDER`,
    `AI_${task}_MODEL`,
  ]),
  "AI_IDENTITY_MODEL",
  "MAIL_FROM",
  "JOB_DIGEST_MIN_MATCH_SCORE",
  "JOB_DIGEST_TARGET_COUNT",
  "JOB_DIGEST_FIRST_LOOK_BACK_DAYS",
  "JOB_DISCOVERY_BUDGET_JOB_OFFERS",
  "JOB_DISCOVERY_BUDGET_EUR",
  "JOB_DISCOVERY_BUDGET_SECONDS",
  "CONTACT_ENRICHMENT_PROVIDER",
  "CONTACT_ENRICHMENT_DPA_SIGNED",
  "EXTENSION_STORE_URL",
];

describe("the Platform Settings catalog", () => {
  it("holds every Platform Setting of ADR-0033, once each", () => {
    const names = PLATFORM_SETTINGS.map((setting) => setting.name);
    expect([...names].sort()).toEqual([...ADR_0033].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every setting a code default its own parser accepts (empty: the code sets nothing)", () => {
    for (const setting of PLATFORM_SETTINGS) {
      expect(typeof setting.default, setting.name).toBe("string");
      if (setting.default !== "") expect(parseSetting(setting, setting.default), setting.name).toMatchObject({ ok: true });
    }
  });

  it("takes each default from the code that reads it", () => {
    const defaultOf = (name: string) => platformSetting(name)?.default;
    expect(defaultOf("ANTHROPIC_ENDPOINT")).toBe("auto");
    expect(defaultOf("BEDROCK_REGION")).toBe("eu-north-1");
    expect(defaultOf("VERTEX_REGION")).toBe("europe-west1");
    expect(defaultOf("OPENAI_DATA_RESIDENCY")).toBe("eu");
    expect(defaultOf("AI_SCORING_PROVIDER")).toBe("anthropic");
    expect(defaultOf("AI_WEB_SEARCH_PROVIDER")).toBe("perplexity");
    // Job titles take the Job Offer analysis' provider: nothing of their own.
    expect(defaultOf("AI_JOB_TITLES_PROVIDER")).toBe("");
    expect(defaultOf("AI_SCORING_MODEL")).toBe("");
    expect(defaultOf("JOB_DIGEST_MIN_MATCH_SCORE")).toBe("60");
    expect(defaultOf("JOB_DIGEST_TARGET_COUNT")).toBe("10");
    expect(defaultOf("JOB_DIGEST_FIRST_LOOK_BACK_DAYS")).toBe("7");
    expect(defaultOf("JOB_DISCOVERY_BUDGET_JOB_OFFERS")).toBe("30");
    expect(defaultOf("JOB_DISCOVERY_BUDGET_EUR")).toBe("0.08");
    expect(defaultOf("JOB_DISCOVERY_BUDGET_SECONDS")).toBe("90");
    expect(defaultOf("MAIL_FROM")).toBe("Jobbbox <bonjour@localhost>");
    expect(defaultOf("CONTACT_ENRICHMENT_PROVIDER")).toBe("");
    expect(defaultOf("CONTACT_ENRICHMENT_DPA_SIGNED")).toBe("false");
    expect(defaultOf("EXTENSION_STORE_URL")).toBe("");
  });

  it("puts each setting in its group", () => {
    const groupOf = (name: string) => platformSetting(name)?.group;
    expect(groupOf("ANTHROPIC_ENDPOINT")).toBe("ai_routing");
    expect(groupOf("AI_IDENTITY_MODEL")).toBe("ai_routing");
    expect(groupOf("MAIL_FROM")).toBe("email");
    expect(groupOf("JOB_DIGEST_TARGET_COUNT")).toBe("job_digest");
    expect(groupOf("JOB_DISCOVERY_BUDGET_EUR")).toBe("job_discovery");
    expect(groupOf("CONTACT_ENRICHMENT_DPA_SIGNED")).toBe("enriched_contacts");
    expect(groupOf("EXTENSION_STORE_URL")).toBe("extension");
  });

  it("parses a value the way the code parses env: an allowed list, a bounded number, text or a boolean", () => {
    const setting = (name: string) => platformSetting(name)!;
    expect(parseSetting(setting("ANTHROPIC_ENDPOINT"), "bedrock")).toEqual({ ok: true, value: "bedrock" });
    expect(parseSetting(setting("ANTHROPIC_ENDPOINT"), "us-east")).toMatchObject({ ok: false });
    expect(parseSetting(setting("JOB_DIGEST_MIN_MATCH_SCORE"), "75")).toEqual({ ok: true, value: 75 });
    expect(parseSetting(setting("JOB_DIGEST_MIN_MATCH_SCORE"), "101")).toMatchObject({ ok: false });
    expect(parseSetting(setting("JOB_DIGEST_FIRST_LOOK_BACK_DAYS"), "0")).toEqual({ ok: true, value: 0 });
    expect(parseSetting(setting("JOB_DIGEST_TARGET_COUNT"), "2.5")).toMatchObject({ ok: false });
    // The budget is above 0, not from it.
    expect(parseSetting(setting("JOB_DISCOVERY_BUDGET_EUR"), "0.15")).toEqual({ ok: true, value: 0.15 });
    expect(parseSetting(setting("JOB_DISCOVERY_BUDGET_EUR"), "0")).toMatchObject({ ok: false });
    expect(parseSetting(setting("JOB_DISCOVERY_BUDGET_SECONDS"), "600")).toEqual({ ok: true, value: 600 });
    expect(parseSetting(setting("JOB_DISCOVERY_BUDGET_SECONDS"), "601")).toMatchObject({ ok: false });
    expect(parseSetting(setting("CONTACT_ENRICHMENT_PROVIDER"), "Lusha")).toEqual({ ok: true, value: "lusha" });
    expect(parseSetting(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "true")).toEqual({ ok: true, value: true });
    expect(parseSetting(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "yes")).toMatchObject({ ok: false });
    expect(parseSetting(setting("MAIL_FROM"), "Jobbbox <hello@jobbbox.ai>")).toEqual({ ok: true, value: "Jobbbox <hello@jobbbox.ai>" });
  });
});
