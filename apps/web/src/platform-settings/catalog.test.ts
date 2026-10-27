import { describe, expect, it } from "vitest";
import { asksConfirmation, isEditable, parseSetting, PLATFORM_SETTINGS, platformSetting } from "./catalog";

/** Every Platform Setting ADR-0033 lists, by name, and ADR-0043's Search provider settings. */
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
  "AI_WEB_SEARCH_FALLBACK_PROVIDER",
  "PERPLEXITY_SEARCH_TYPE",
  "PERPLEXITY_QUERIES_PER_CALL",
  "BRAVE_MAX_PAGES",
  "TAVILY_SEARCH_DEPTH",
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

/** The web search's bounded settings (#386, #402) on Paramètres' Recherche web tab: its country, so far (#407 explains it). */
const WEB_SEARCH = ["JOB_DISCOVERY_COUNTRY"];

describe("the Platform Settings catalog", () => {
  it("holds every Platform Setting of ADR-0033 and the web search's bounded settings, once each", () => {
    const names = PLATFORM_SETTINGS.map((setting) => setting.name);
    expect([...names].sort()).toEqual([...ADR_0033, ...WEB_SEARCH].sort());
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
    expect(defaultOf("AI_WEB_SEARCH_FALLBACK_PROVIDER")).toBe("none");
    expect(defaultOf("PERPLEXITY_SEARCH_TYPE")).toBe("fast");
    expect(defaultOf("PERPLEXITY_QUERIES_PER_CALL")).toBe("5");
    expect(defaultOf("BRAVE_MAX_PAGES")).toBe("10");
    expect(defaultOf("TAVILY_SEARCH_DEPTH")).toBe("basic");
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

  it("gives the web search's country the default #386 decided, editable on Paramètres", () => {
    expect(platformSetting("JOB_DISCOVERY_COUNTRY")).toMatchObject({ group: "web_search", default: "FR" });
    expect(isEditable(platformSetting("JOB_DISCOVERY_COUNTRY")!)).toBe(true);
  });

  it("takes a country as a two-letter code, kept in upper case", () => {
    const country = platformSetting("JOB_DISCOVERY_COUNTRY")!;
    expect(parseSetting(country, " be ")).toEqual({ ok: true, value: "BE" });
    expect(parseSetting(country, "France")).toMatchObject({ ok: false, error: expect.stringContaining("a two-letter country code") });
    expect(parseSetting(country, "F1")).toMatchObject({ ok: false });
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
    expect(parseSetting(setting("CONTACT_ENRICHMENT_PROVIDER"), "none")).toEqual({ ok: true, value: "none" });
    expect(parseSetting(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "true")).toEqual({ ok: true, value: true });
    expect(parseSetting(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "yes")).toMatchObject({ ok: false });
    expect(parseSetting(setting("MAIL_FROM"), "Jobbbox <hello@jobbbox.ai>")).toEqual({ ok: true, value: "Jobbbox <hello@jobbbox.ai>" });
  });

  it("takes the extension's store page as an https URL only (#303)", () => {
    const store = platformSetting("EXTENSION_STORE_URL")!;
    const page = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
    expect(parseSetting(store, ` ${page} `)).toEqual({ ok: true, value: page });
    expect(parseSetting(store, "http://chromewebstore.google.com/detail/jobbbox")).toMatchObject({ ok: false, error: expect.stringContaining("an https URL") });
    expect(parseSetting(store, "chromewebstore.google.com/detail/jobbbox")).toMatchObject({ ok: false });
    expect(parseSetting(store, "javascript:alert(1)")).toMatchObject({ ok: false });
    expect(parseSetting(store, "https://")).toMatchObject({ ok: false });
  });

  it("takes as MAIL_FROM an email sender, with or without a name, and refuses anything else", () => {
    const mailFrom = platformSetting("MAIL_FROM")!;
    expect(parseSetting(mailFrom, " hello@jobbbox.ai ")).toEqual({ ok: true, value: "hello@jobbbox.ai" });
    expect(parseSetting(mailFrom, '"Jobbbox" <hello@jobbbox.ai>')).toEqual({ ok: true, value: '"Jobbbox" <hello@jobbbox.ai>' });
    expect(parseSetting(mailFrom, "<hello@jobbbox.ai>")).toMatchObject({ ok: true });
    for (const refused of ["Jobbbox", "Jobbbox <hello>", "hello@", "@jobbbox.ai", "Jobbbox <hello@jobbbox.ai", "hello @jobbbox.ai", "a@b.ai, c@d.ai", "Jobbbox <hello@jobbbox.ai>\r\nBcc: x@y.z"]) {
      expect(parseSetting(mailFrom, refused), refused).toMatchObject({ ok: false });
    }
  });
});

describe("which Platform Settings super-admins edit on Paramètres", () => {
  const setting = (name: string) => platformSetting(name)!;

  it("are every group's, now that each slice of ADR-0033 has shipped (#299, #300, #301, #302, #303)", () => {
    for (const name of ["ANTHROPIC_ENDPOINT", "MAIL_FROM", "JOB_DIGEST_TARGET_COUNT", "JOB_DISCOVERY_BUDGET_EUR", "CONTACT_ENRICHMENT_PROVIDER", "CONTACT_ENRICHMENT_DPA_SIGNED", "EXTENSION_STORE_URL"]) {
      expect(isEditable(setting(name)), name).toBe(true);
    }
  });

  it("asks a super-admin to confirm a DPA marked signed, and nothing else (ADR-0015, #302)", () => {
    expect(asksConfirmation(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "true")).toBe(true);
    expect(asksConfirmation(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), " true ")).toBe(true);
    expect(asksConfirmation(setting("CONTACT_ENRICHMENT_DPA_SIGNED"), "false")).toBe(false);
    expect(asksConfirmation(setting("CONTACT_ENRICHMENT_PROVIDER"), "lusha")).toBe(false);
    expect(asksConfirmation(setting("JOB_DIGEST_TARGET_COUNT"), "12")).toBe(false);
  });
});
