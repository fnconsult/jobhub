import type { CvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { cvChanges, flagOfferWording, stemOf, withChanges, wordsOf, type CvChange } from "./changes";

const master: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Directrice financière depuis 2005.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS de 12 filiales." },
    { title: "Contrôleuse de gestion", employer: "Danone", location: "Paris", period: "1995 – 2005", description: "Budget et reporting mensuel." },
    { title: "Auditrice", employer: "KPMG", location: "Paris", period: "1990 – 1995", description: "Audit légal." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["Reporting", "IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

/** Rephrased headline, summary and first job; Danone cut; skills reordered; Power BI added once confirmed. */
const tailored: CvContent = {
  ...master,
  headline: "Directrice administrative et financière",
  summary: "Directrice financière depuis 2005, management de managers.",
  experience: [{ ...master.experience[0]!, description: "Pilotage de la consolidation IFRS de 12 filiales." }, master.experience[2]!],
  skills: ["IFRS", "SAP", "Reporting", "Power BI"],
};
const origins = { education: [0], skills: [1, 2, 0], languages: [0] };

const find = (changes: CvChange[], section: string, kind: string) => changes.find((change) => change.section === section && change.kind === kind)!;

describe("the changes of a Tailored CV, accepted or rejected one by one", () => {
  it("each change has its own id, the same whatever else the Candidate confirmed", () => {
    const changes = cvChanges(master, tailored, origins);

    expect(new Set(changes.map((change) => change.id)).size).toBe(changes.length);
    const withoutPowerBi = cvChanges(master, { ...tailored, skills: ["IFRS", "SAP", "Reporting"] }, origins);
    expect(withoutPowerBi.map((change) => change.id)).toEqual(changes.filter((change) => change.kind !== "added").map((change) => change.id));
  });

  it("with every change accepted, the Tailored CV is as proposed", () => {
    const changes = cvChanges(master, tailored, origins);

    expect(withChanges(master, tailored, changes.map((change) => change.id), origins)).toEqual(tailored);
  });

  it("with no change accepted, the Tailored CV says what the Master CV says", () => {
    expect(withChanges(master, tailored, [], origins)).toEqual(master);
  });

  it("only the accepted changes are kept: each rejected one keeps the Master CV's", () => {
    const changes = cvChanges(master, tailored, origins);
    const accepted = [find(changes, "headline", "rephrased"), find(changes, "experience", "rephrased"), find(changes, "skills", "added")].map((change) => change.id);

    expect(withChanges(master, tailored, accepted, origins)).toEqual({
      ...master,
      headline: "Directrice administrative et financière",
      // Rejected rephrasing.
      summary: master.summary,
      // The rephrased job, the cut one back in its place.
      experience: [tailored.experience[0], master.experience[1], master.experience[2]],
      // Rejected reorder, accepted addition.
      skills: ["Reporting", "IFRS", "SAP", "Power BI"],
    });
  });

  it("a cut item rejected comes back after the item it followed, in the order the Candidate accepted", () => {
    const reordered: CvContent = { ...master, skills: ["SAP", "Reporting"] };
    const changes = cvChanges(master, reordered, { ...origins, skills: [2, 0] });
    const reorder = find(changes, "skills", "reordered").id;

    expect(withChanges(master, reordered, [reorder], { ...origins, skills: [2, 0] }).skills).toEqual(["SAP", "Reporting", "IFRS"]);
  });

  it("ids name nothing outside the proposal: an unknown id changes nothing", () => {
    expect(withChanges(master, tailored, ["nothing.here"], origins)).toEqual(master);
  });
});

describe("the Job Offer's words a rephrasing brings in, flagged for the Candidate to check", () => {
  it("are meaningful terms, not word fragments or the offer's everyday words", () => {
    const offer = "Membre du comité de direction, vous avez une forte capacité à travailler jusqu'à l'international, en omnicanal.";
    const offerStems = wordsOf(offer).map(stemOf);
    const change: CvChange = { id: "summary", section: "summary", kind: "rephrased", master: "Directrice financière.", tailored: `Directrice financière. ${offer}` };

    const [flagged] = flagOfferWording([change], offerStems);

    expect(flagged!.fromOffer).toEqual(["comité", "direction", "international", "omnicanal"]);
  });
});
