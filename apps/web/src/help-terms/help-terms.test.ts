import { article } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { createMentions, EMPTY_STATE_HELP, HELP_TERMS, termsWithin } from ".";

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

describe("the terms a sentence names", () => {
  it("splits the sentence around each term's words, keeping the sentence's own case", () => {
    expect(termsWithin("Votre quota se renouvelle chaque lundi.", { planQuota: "quota" })).toEqual(["Votre ", { term: "planQuota", words: "quota" }, " se renouvelle chaque lundi."]);
    expect(termsWithin("Match Score with the “Cadre” profile:", { matchScore: "Match score" })).toEqual([{ term: "matchScore", words: "Match Score" }, " with the “Cadre” profile:"]);
  });

  it("names several terms, in the order the sentence has them", () => {
    expect(
      termsWithin("L'ATS Score mesure comment les ATS lisent votre CV de référence.", { masterCv: "CV de référence", atsScore: "ATS Score" }),
    ).toEqual(["L'", { term: "atsScore", words: "ATS Score" }, " mesure comment les ATS lisent votre ", { term: "masterCv", words: "CV de référence" }, "."]);
  });

  it("takes each term's first occurrence", () => {
    expect(termsWithin("Aucun CV adapté pour l'instant. Le CV adapté…", { tailoredCv: "CV adapté" })).toEqual(["Aucun ", { term: "tailoredCv", words: "CV adapté" }, " pour l'instant. Le CV adapté…"]);
  });

  it("leaves out a term the sentence does not name (a language that words it otherwise)", () => {
    expect(termsWithin("CV tailored to the offer", { tailoredCv: "Tailored CV" })).toEqual(["CV tailored to the offer"]);
    expect(termsWithin("Le CV enregistré reste en place.", { masterCv: "" })).toEqual(["Le CV enregistré reste en place."]);
  });

  it("leaves out a term whose words overlap another's, named earlier", () => {
    expect(termsWithin("Le score de correspondance du CV", { matchScore: "score de correspondance", masterCv: "correspondance du CV" })).toEqual([
      "Le ",
      { term: "matchScore", words: "score de correspondance" },
      " du CV",
    ]);
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
