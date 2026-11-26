import { describe, expect, it } from "vitest";
import { ALWAYS_ON_GUARDRAILS, guardrailSettingsOf, guardrailsOf, GUARDRAIL_IDS, hasGuardrailMessage } from "./index";
import { candidateDataInIssue, ISSUE_QUOTE_WORDS } from "./issue";

/** A fictitious Candidate: never a real Signalement's text, in a test or anywhere in git. */
const IDENTITY = { fullName: ["Marie Dupont"], givenName: ["Marie"], lastName: ["Dupont"], preferredName: "Marie", email: ["marie.dupont@example.fr"], phone: ["06 12 34 56 78"] };
const MESSAGE = "Quand je clique sur le bouton Enregistrer de ma lettre de motivation, la page devient blanche et je perds tout mon texte.";

const clean = {
  title: "Lettre de motivation : écran vide après « Enregistrer »",
  summary: "Enregistrer une lettre de motivation affiche une page vide ; le texte saisi est perdu.",
  steps: "1. Ouvrir une candidature.\n2. Écrire une lettre de motivation.\n3. Cliquer sur « Enregistrer ».",
  expected: "La lettre est enregistrée et reste affichée.",
  environment: "Beta",
  version: "1.42.0 (main·35e2ea1)",
  device: "Chrome 141, Mac",
};

const check = (fields: Record<string, string>) => candidateDataInIssue(fields, { identity: IDENTITY, words: [MESSAGE] });

describe("« Données du Candidate dans une issue » (ADR-0118): what Jobbbox checks before it publishes an issue", () => {
  it("lets a clean issue through, as written", () => {
    expect(check(clean)).toEqual({ ok: true, fields: clean });
  });

  it("blocks an issue that quotes the Candidate's message word for word", () => {
    const quoting = { ...clean, summary: "La candidate écrit : « la page devient blanche et je perds tout mon texte »." };

    expect(check(quoting)).toEqual({ ok: false, reasons: ["verbatim_quote"], fields: ["summary"] });
  });

  it("blocks a quote of the message as the agent read it, redacted", () => {
    const words = ["Je suis [NOM] et quand je valide mon profil rien ne se passe du tout."];
    const quoting = { ...clean, steps: "Le Candidate dit : quand je valide mon profil rien ne se passe." };

    expect(candidateDataInIssue(quoting, { identity: IDENTITY, words })).toMatchObject({ ok: false, reasons: ["verbatim_quote"], fields: ["steps"] });
  });

  it(`lets through a few words in common with the message: fewer than ${ISSUE_QUOTE_WORDS} in a row is no quote`, () => {
    const close = { ...clean, summary: "Le bouton Enregistrer de la lettre de motivation vide la page." };

    expect(check(close)).toMatchObject({ ok: true });
  });

  it("blocks an issue that names the Candidate, even by their Preferred Name", () => {
    expect(check({ ...clean, summary: "Marie Dupont ne peut plus enregistrer sa lettre." })).toEqual({ ok: false, reasons: ["identity"], fields: ["summary"] });
    expect(check({ ...clean, title: "Marie perd sa lettre de motivation" })).toEqual({ ok: false, reasons: ["identity"], fields: ["title"] });
  });

  it("blocks an email address or a phone number in the steps, the Candidate's or anyone's", () => {
    expect(check({ ...clean, steps: "1. Se connecter avec marie.dupont@example.fr.\n2. Ouvrir une candidature." })).toEqual({ ok: false, reasons: ["email"], fields: ["steps"] });
    expect(check({ ...clean, steps: "1. Appeler le 06 12 34 56 78 pour reproduire." })).toEqual({ ok: false, reasons: ["phone"], fields: ["steps"] });
    expect(check({ ...clean, steps: "1. Écrire à quelquun@exemple.test ou au 07 98 76 54 32." })).toEqual({ ok: false, reasons: ["email", "phone"], fields: ["steps"] });
  });

  it("gives every reason and every field at fault, in a fixed order", () => {
    const all = { ...clean, title: "Marie Dupont", steps: "Appeler le 06 12 34 56 78", expected: "la page devient blanche et je perds tout mon texte" };

    expect(check(all)).toEqual({ ok: false, reasons: ["identity", "phone", "verbatim_quote"], fields: ["title", "steps", "expected"] });
  });

  it("lets through the placeholders Redaction left in what the agent read", () => {
    expect(check({ ...clean, summary: "[PRÉNOM] ne peut plus enregistrer sa lettre ([E-MAIL])." })).toMatchObject({ ok: true });
  });

  it("checks even without the Candidate's identity: email and phone by their shape, and quotes", () => {
    expect(candidateDataInIssue({ ...clean, steps: "Écrire à marie.dupont@example.fr" }, { identity: null, words: [MESSAGE] })).toMatchObject({ ok: false, reasons: ["email"] });
  });
});

describe("« Données du Candidate dans une issue » can never be switched off", () => {
  it("is a Guardrail of the catalogue, always on, that only blocks", () => {
    expect(GUARDRAIL_IDS).toContain("candidate_data_in_issue");
    expect(ALWAYS_ON_GUARDRAILS).toContain("candidate_data_in_issue");
    expect(guardrailSettingsOf("candidate_data_in_issue")).toEqual(["block"]);
  });

  it("is Signalement triage's only Guardrail, and answers with no Guardrail message: the agent reads its reasons", () => {
    expect(guardrailsOf("signalement_triage")).toEqual(["candidate_data_in_issue"]);
    expect(hasGuardrailMessage("candidate_data_in_issue")).toBe(false);
  });

  it("takes no setting at all: no option, environment variable or setting can turn it off", () => {
    // Its only inputs are the texts and the Candidate: there is nothing else to pass it.
    expect(candidateDataInIssue.length).toBe(2);
    const before = { ...process.env };
    try {
      process.env.GUARDRAILS = "off";
      process.env.CANDIDATE_DATA_IN_ISSUE = "off";
      expect(check({ ...clean, title: "Marie Dupont" })).toMatchObject({ ok: false });
    } finally {
      process.env = before;
    }
  });
});
