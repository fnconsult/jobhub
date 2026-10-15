import type { MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { isDirty, nextDraft, saveRequest, startDraft } from "./master-cv-draft";

const cv: MasterCvContent = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@exemple.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Plus de 25 ans dans l'industrie.",
  experience: [
    { title: "Directrice administrative et financière", employer: "Groupe Sorelis", location: "Lyon", period: "2015 – 2026", description: "Refinancement de 45 M€." },
    { title: "Responsable du contrôle de gestion", employer: "Distrimag", location: "Villeurbanne", period: "2007 – 2015", description: "Budget de 42 magasins." },
  ],
  education: [{ degree: "Master CCA", institution: "IAE Lyon", year: "1999" }],
  skills: ["Consolidation IFRS", "Excel avancé, Power BI"],
  languages: [{ name: "Anglais", level: "courant" }],
};

describe("the Master CV draft on the Profile page", () => {
  it("starts with nothing to save, its fields showing the version it is based on", () => {
    const draft = startDraft(7, cv);
    expect(isDirty(draft)).toBe(false);
    expect(draft.fields).toEqual({
      headline: "Directrice administrative et financière",
      summary: "Plus de 25 ans dans l'industrie.",
      descriptions: ["Refinancement de 45 M€.", "Budget de 42 magasins."],
      skills: "Consolidation IFRS\nExcel avancé, Power BI",
    });
    expect(draft.nextVersion).toBe(8);
  });

  it("gathers edits into one save of the next version, based on the version edited (ADR-0012)", () => {
    let draft = startDraft(7, cv);
    draft = nextDraft(draft, { type: "edit", changes: { summary: "Plus de 15 ans dans l'industrie." } });
    draft = nextDraft(draft, { type: "edit", changes: { skills: "Consolidation IFRS\nExcel avancé\nPower BI\n" } });
    draft = nextDraft(draft, { type: "edit", changes: { descriptions: ["Refinancement de 45 M€ de dette.", "Budget de 42 magasins."] } });
    expect(isDirty(draft)).toBe(true);
    expect(saveRequest(draft)).toEqual({
      basedOnVersion: 7,
      content: {
        ...cv,
        summary: "Plus de 15 ans dans l'industrie.",
        skills: ["Consolidation IFRS", "Excel avancé", "Power BI"],
        experience: [{ ...cv.experience[0], description: "Refinancement de 45 M€ de dette." }, cv.experience[1]],
      },
    });
  });

  it("has nothing to save when an edit only changes blank lines or spaces between skills", () => {
    const draft = nextDraft(startDraft(7, cv), { type: "edit", changes: { skills: "Consolidation IFRS\n\n  Excel avancé, Power BI  \n" } });
    expect(isDirty(draft)).toBe(false);
  });

  it("cancelling puts back the version the edits were based on", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } });
    const cancelled = nextDraft(edited, { type: "cancel" });
    expect(isDirty(cancelled)).toBe(false);
    expect(cancelled.fields.headline).toBe(cv.headline);
  });

  it("once saved, the new version is the one further edits are based on", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { skills: "IFRS\n\nTrésorerie\n" } });
    const saved = nextDraft(nextDraft(edited, { type: "save" }), { type: "answered", status: 200, body: { version: 8 } });
    expect(saved.status).toEqual({ kind: "saved", version: 8 });
    expect(isDirty(saved)).toBe(false);
    expect(saved.fields.skills).toBe("IFRS\nTrésorerie");
    expect(saveRequest(saved).basedOnVersion).toBe(8);
    expect(saved.nextVersion).toBe(9);
  });

  it("is saving while the save is under way", () => {
    const draft = nextDraft(nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } }), { type: "save" });
    expect(draft.status).toEqual({ kind: "saving" });
  });

  it("keeps the edits when another save made the version outdated, and says which version is current", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } });
    const refused = nextDraft(nextDraft(edited, { type: "save" }), { type: "answered", status: 409, body: { currentVersion: 9 } });
    expect(refused.status).toEqual({ kind: "conflict", currentVersion: 9 });
    expect(refused.fields.headline).toBe("DAF");
    expect(saveRequest(refused).basedOnVersion).toBe(7);
  });

  it("keeps the edits when the save is invalid or fails", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } });
    expect(nextDraft(edited, { type: "answered", status: 400, body: { errors: [] } }).status).toEqual({ kind: "invalid" });
    expect(nextDraft(edited, { type: "answered", status: 500, body: {} }).status).toEqual({ kind: "failed" });
    expect(nextDraft(edited, { type: "answered", status: 409, body: {} }).status).toEqual({ kind: "failed" });
    expect(nextDraft(edited, { type: "failed" }).status).toEqual({ kind: "failed" });
    expect(nextDraft(edited, { type: "failed" }).fields.headline).toBe("DAF");
  });

  it("an edit clears what the last save said", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } });
    const failed = nextDraft(edited, { type: "failed" });
    expect(nextDraft(failed, { type: "edit", changes: { headline: "DAF senior" } }).status).toEqual({ kind: "editing" });
  });

  it("follows a newer version the page brings (an accepted ATS Fix) when there are no edits", () => {
    const fixed = { ...cv, skills: [...cv.skills, "Tagetik"] };
    const draft = nextDraft(startDraft(7, cv), { type: "loaded", version: 8, content: fixed });
    expect(draft.basedOnVersion).toBe(8);
    expect(draft.fields.skills).toBe("Consolidation IFRS\nExcel avancé, Power BI\nTagetik");
    expect(isDirty(draft)).toBe(false);
  });

  it("keeps the edits, still based on the version edited, when a newer version arrives meanwhile", () => {
    const edited = nextDraft(startDraft(7, cv), { type: "edit", changes: { headline: "DAF" } });
    const draft = nextDraft(edited, { type: "loaded", version: 8, content: { ...cv, skills: ["IFRS"] } });
    expect(draft.fields.headline).toBe("DAF");
    expect(saveRequest(draft).basedOnVersion).toBe(7);
  });
});
