import { article } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { createMentions, EMPTY_STATE_HELP, HELP_TERMS, wordsWithin } from ".";

describe("a term mentioned twice on a page is a button only the first time (#343)", () => {
  it("the first mention of a term on a page is the one that opens its Help Article", () => {
    const mentions = createMentions();
    expect(mentions.isFirst("/candidatures/a/correspondance", "matchScore", "m1")).toBe(true);
    expect(mentions.isFirst("/candidatures/a/correspondance", "matchScore", "m2")).toBe(false);
  });

  it("each term has its own first mention", () => {
    const mentions = createMentions();
    expect(mentions.isFirst("/profils/p", "atsScore", "m1")).toBe(true);
    expect(mentions.isFirst("/profils/p", "masterCv", "m2")).toBe(true);
  });

  it("the first mention stays the first however often it is shown again", () => {
    const mentions = createMentions();
    mentions.isFirst("/profils/p", "atsScore", "m1");
    mentions.isFirst("/profils/p", "atsScore", "m2");
    expect(mentions.isFirst("/profils/p", "atsScore", "m1")).toBe(true);
    expect(mentions.isFirst("/profils/p", "atsScore", "m2")).toBe(false);
  });

  it("another page starts afresh: its first mention is a button again", () => {
    const mentions = createMentions();
    mentions.isFirst("/profils/p/ats-score", "atsScore", "m1");
    expect(mentions.isFirst("/profils/p/cv-de-reference", "atsScore", "m2")).toBe(true);
  });

  it("once the first mention is gone from the page, the next one shown becomes the first", () => {
    const mentions = createMentions();
    mentions.isFirst("/profils/p", "atsScore", "m1");
    mentions.forget("atsScore", "m1");
    expect(mentions.isFirst("/profils/p", "atsScore", "m2")).toBe(true);
  });

  it("forgetting a mention that is not the first changes nothing", () => {
    const mentions = createMentions();
    mentions.isFirst("/profils/p", "atsScore", "m1");
    mentions.forget("atsScore", "m2");
    expect(mentions.isFirst("/profils/p", "atsScore", "m3")).toBe(false);
  });
});

describe("the words of a sentence that name the term", () => {
  it("splits the sentence around them, keeping the sentence's own case", () => {
    expect(wordsWithin("Votre quota se renouvelle chaque lundi.", "quota")).toEqual(["Votre ", "quota", " se renouvelle chaque lundi."]);
    expect(wordsWithin("Match Score with the “Cadre” profile:", "Match score")).toEqual(["", "Match Score", " with the “Cadre” profile:"]);
  });

  it("takes their first occurrence", () => {
    expect(wordsWithin("Aucun CV adapté pour l'instant. Le CV adapté…", "CV adapté")).toEqual(["Aucun ", "CV adapté", " pour l'instant. Le CV adapté…"]);
  });

  it("is the whole sentence when the words are not in it (a language that words it otherwise)", () => {
    expect(wordsWithin("CV tailored to the offer", "Tailored CV")).toEqual(["", "CV tailored to the offer", ""]);
  });
});

describe("the Help Article each term and each empty state opens", () => {
  it("every term opens a glossary entry, in French and in English", () => {
    for (const id of Object.values(HELP_TERMS)) {
      expect(article(id, "fr")?.kind, id).toBe("glossary");
      expect(article(id, "en")?.kind, id).toBe("glossary");
    }
  });

  it("every empty state opens an article, in French and in English", () => {
    for (const id of Object.values(EMPTY_STATE_HELP)) {
      expect(article(id, "fr"), id).not.toBeNull();
      expect(article(id, "en"), id).not.toBeNull();
    }
  });

  it("covers the listed terms and empty states", () => {
    expect(Object.keys(HELP_TERMS).sort()).toEqual(["atsScore", "followUp", "masterCv", "matchScore", "planQuota", "proposals", "tailoredCv"]);
    expect(Object.keys(EMPTY_STATE_HELP).sort()).toEqual(["agenda", "applications", "followUps", "jobSearches", "profiles", "proposals"]);
  });
});
