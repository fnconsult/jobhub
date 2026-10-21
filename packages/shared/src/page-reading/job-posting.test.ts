import { describe, expect, it } from "vitest";
import { readJobPosting } from "./job-posting";

const page = (posting: Record<string, unknown>) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "http://schema.org",
    "@type": "JobPosting",
    title: "Chef de Projet Corporate H/F",
    description: "<p>La Direction ISR recrute un chef de projet.</p>",
    ...posting,
  })}</script></head><body></body></html>`;

describe("reading a JobPosting's Posting date", () => {
  it("reads a French day/month/year datePosted, as groupecreditagricole.jobs states it", () => {
    expect(readJobPosting(page({ datePosted: "19/10/2026" }))?.postedAt).toEqual(new Date("2026-10-19T00:00:00Z"));
  });
});

describe("reading a JobPosting's skills", () => {
  it("splits a plain list on commas and semicolons", () => {
    expect(readJobPosting(page({ skills: "SQL, Python; Power BI" }))?.skills).toEqual(["SQL", "Python", "Power BI"]);
  });

  it("reads skills written as an HTML list one per item, leaving out the prose around it", () => {
    // As groupecreditagricole.jobs states them: a list, then paragraphs on remote work and disability.
    const skills =
      "<ul><li>Leadership naturel et capacité à fédérer ;</li><li>Sens du résultat et de l'engagement ;</li>" +
      "<li>Adaptabilité et réactivité dans des environnements exigeants.</li></ul><p> </p>" +
      "<p>La majorité des postes est éligible au télétravail dans les conditions prévues par notre accord reposant sur le double volontariat " +
      "(collaborateur &amp; manager) et après une période d’intégration réussie, selon les modalités définies avec votre manager et votre équipe.</p>";

    expect(readJobPosting(page({ skills }))?.skills).toEqual([
      "Leadership naturel et capacité à fédérer",
      "Sens du résultat et de l'engagement",
      "Adaptabilité et réactivité dans des environnements exigeants",
    ]);
  });

  it("states no skills when none is short enough to be one", () => {
    expect(readJobPosting(page({ skills: `<p>${"Une longue phrase de présentation. ".repeat(10)}</p>` }))?.skills).toBeUndefined();
  });
});
