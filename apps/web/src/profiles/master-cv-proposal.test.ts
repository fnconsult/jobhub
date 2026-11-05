import type { MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { acceptedMasterCv, masterCvReview } from "./master-cv-proposal";

const master: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." },
    { title: "Contrôleuse de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "Budget et reporting." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Consolidation"],
  languages: [{ name: "Anglais", level: "courant" }],
};

describe("a Master CV change proposed by the AI Coach, reviewed change by change (#719, ADR-0006)", () => {
  it("rephrases, cuts, reorders and puts forward items the Master CV has, each a change of its own", () => {
    const review = masterCvReview(master, [
      { kind: "rephrase", section: "summary", text: "25 ans de direction financière dans l'industrie." },
      { kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Pilotage financier d'un groupe industriel coté." },
      { kind: "cut", section: "skills", item: "sap" },
      { kind: "highlight", section: "skills", item: "Consolidation" },
    ]);

    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.changes.map((change) => change.id)).toEqual(["summary.rephrased", "experience.rephrased.0", "skills.cut.1", "skills.reordered"]);
    expect(review.changes.every((change) => change.kind !== "added")).toBe(true);

    const all = acceptedMasterCv(master, review.edits, review.changes.map((change) => change.id));
    expect(all.summary).toBe("25 ans de direction financière dans l'industrie.");
    expect(all.experience[0]).toEqual({ ...master.experience[0], description: "Pilotage financier d'un groupe industriel coté." });
    expect(all.skills).toEqual(["Consolidation", "IFRS"]);
    // The Identity block and what is not changed are the Master CV's.
    expect({ ...all, summary: master.summary, experience: master.experience, skills: master.skills }).toEqual(master);
  });

  it("keeps the Master CV's text, place or item for every change not accepted", () => {
    const review = masterCvReview(master, [
      { kind: "rephrase", section: "headline", text: "DAF industrie" },
      { kind: "reorder", section: "experience", order: ["Renault", "Groupe Seb"] },
    ]);
    if (!review.ok) throw new Error("not reviewed");

    expect(acceptedMasterCv(master, review.edits, [])).toEqual(master);
    expect(acceptedMasterCv(master, review.edits, ["experience.reordered"]).experience.map((job) => job.employer)).toEqual(["Renault", "Groupe Seb"]);
    expect(acceptedMasterCv(master, review.edits, ["experience.reordered"]).headline).toBe(master.headline);
  });

  it("never adds a fact: an item the Master CV does not have is refused, and a job's employer and dates stay its own", () => {
    expect(masterCvReview(master, [{ kind: "cut", section: "skills", item: "Python" }])).toEqual({ ok: false, error: "unknown_item", item: "Python" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "experience", item: "Airbus", title: "DAF" }])).toEqual({ ok: false, error: "unknown_item", item: "Airbus" });

    const review = masterCvReview(master, [{ kind: "rephrase", section: "experience", item: "Renault", title: "Contrôleuse de gestion senior" }]);
    if (!review.ok) throw new Error("not reviewed");
    const applied = acceptedMasterCv(master, review.edits, review.changes.map((change) => change.id));
    expect(applied.experience[1]).toEqual({ ...master.experience[1], title: "Contrôleuse de gestion senior" });
  });

  it("never adds a skill under cover of rephrasing one: into several, or into another skill, it is refused", () => {
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "SAP, HubSpot, Power BI" }])).toEqual({ ok: false, error: "added_item", text: "SAP, HubSpot, Power BI" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "ERP • CRM\nHubSpot" }])).toMatchObject({ ok: false, error: "added_item" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "IFRS", text: "Power BI" }])).toEqual({ ok: false, error: "added_item", text: "Power BI" });

    const review = masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "SAP ERP" }]);
    expect(review.ok && review.changes.map((change) => [change.id, change.tailored])).toEqual([["skills.rephrased.1", "SAP ERP"]]);
  });

  it("flags a rephrasing that brings words of a Job Offer the Master CV lacks: a Flagged Change, never saved without an explicit accept", () => {
    const review = masterCvReview(master, [{ kind: "rephrase", section: "summary", text: "25 ans dans l'industrie aéronautique, expert Kyriba." }], {
      offers: ["Directeur financier, secteur aéronautique. Maîtrise de Kyriba et des normes IFRS."],
    });
    if (!review.ok) throw new Error("not reviewed");

    const [change] = review.changes;
    expect(change).toMatchObject({ id: "summary.rephrased", fromOffer: ["aéronautique", "Kyriba"] });
    // Not accepted (nothing sent for it): the Master CV's words stay.
    expect(acceptedMasterCv(master, review.edits, []).summary).toBe(master.summary);
    expect(acceptedMasterCv(master, review.edits, ["summary.rephrased"]).summary).toBe("25 ans dans l'industrie aéronautique, expert Kyriba.");
  });

  it("proposes nothing when the edits change nothing", () => {
    expect(masterCvReview(master, [{ kind: "rephrase", section: "headline", text: master.headline }])).toEqual({ ok: false, error: "no_change" });
  });
});
