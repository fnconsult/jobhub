import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalTextsModulePath, readLegalTexts, renderLegalTextsModule } from "./legal-texts-content";

/** Writes `files` ({ "cgu/2026-12-01.fr.md": "…" }) into a fresh legal directory. */
function legalDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "legal-"));
  for (const [file, markdown] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), markdown);
  }
  return dir;
}

const cguFr = `---
title: Conditions générales d'utilisation
effective: 2026-12-01
change: substantielle
approved_by: Camille Martin
summary: Première version des conditions d'utilisation.
---
## En bref
- Jobbbox vous aide à chercher un emploi.
- Vous devez avoir 18 ans.

## Objet
Les présentes conditions encadrent l'usage de Jobbbox.

Écrivez-nous.

## L'extension sans compte {#invite}
- Vous cochez les conditions courtes.
- Rien n'est gardé sur nos serveurs.
`;
const cguEn = `---
title: Terms of use
effective: 2026-12-01
change: substantielle
approved_by: Camille Martin
summary: First version of the terms of use.
---
## In short
- Jobbbox helps you look for a job.

## Purpose
These terms govern the use of Jobbbox.

## The extension without an account {#invite}
- You tick the short terms.
`;
const privacyFr = `---
title: Politique de confidentialité
effective: 2026-12-01
change: substantielle
approved_by: Camille Martin
summary: Première version.
recipients_outside_eu: [anthropic, stripe]
---
## Qui est responsable
FN Consult.

## Cookies {#cookies}
Aucun traceur soumis à consentement.

## IA dans Jobbbox {#ia}
Les voies de l'IA.
`;
const privacyEn = privacyFr
  .replace("Politique de confidentialité", "Privacy policy")
  .replace("Première version.", "First version.")
  .replace("Qui est responsable", "Who is responsible")
  .replace("IA dans Jobbbox", "AI in Jobbbox");

const cgu = { "cgu/2026-12-01.fr.md": cguFr, "cgu/2026-12-01.en.md": cguEn };

describe("readLegalTexts — the Legal Text Versions of a directory", () => {
  it("reads each version: its title, effective date, change, approver, history line, « En bref » and numbered sections", () => {
    const texts = readLegalTexts(legalDir(cgu));

    expect(texts.fr).toEqual([
      {
        text: "cgu",
        locale: "fr",
        effective: "2026-12-01",
        title: "Conditions générales d'utilisation",
        change: "substantielle",
        approvedBy: "Camille Martin",
        summary: "Première version des conditions d'utilisation.",
        inBrief: ["Jobbbox vous aide à chercher un emploi.", "Vous devez avoir 18 ans."],
        sections: [
          { id: "section-1", number: 1, title: "Objet", body: "Les présentes conditions encadrent l'usage de Jobbbox.\n\nÉcrivez-nous." },
          { id: "invite", number: 2, title: "L'extension sans compte", body: "- Vous cochez les conditions courtes.\n- Rien n'est gardé sur nos serveurs." },
        ],
      },
    ]);
    expect(texts.en[0]).toMatchObject({ title: "Terms of use", summary: "First version of the terms of use.", inBrief: ["Jobbbox helps you look for a job."] });
  });

  it("keeps every version of every text, by text then newest first", () => {
    const later = (markdown: string) => markdown.replaceAll("2026-12-01", "2027-03-01").replace("substantielle", "mineure");
    const texts = readLegalTexts(
      legalDir({
        ...cgu,
        "cgu/2027-03-01.fr.md": later(cguFr),
        "cgu/2027-03-01.en.md": later(cguEn),
        "confidentialite/2026-12-01.fr.md": privacyFr,
        "confidentialite/2026-12-01.en.md": privacyEn,
      }),
    );
    expect(texts.fr.map((version) => [version.text, version.effective, version.change])).toEqual([
      ["cgu", "2027-03-01", "mineure"],
      ["cgu", "2026-12-01", "substantielle"],
      ["confidentialite", "2026-12-01", "substantielle"],
    ]);
  });

  it("registers each version for the Acceptances (#510): its id, permanent URL, the French file's SHA-256 and its change", () => {
    const texts = readLegalTexts(legalDir(cgu));
    expect(texts.registry).toEqual([
      {
        text: "cgu",
        version: "2026-12-01",
        url: "/legal/cgu/2026-12-01",
        sha256: createHash("sha256").update(cguFr).digest("hex"),
        change: "substantielle",
      },
    ]);
  });

  it("reads nothing while the team has written no text yet", () => {
    expect(readLegalTexts(path.join(tmpdir(), "no-such-legal-dir"))).toEqual({ fr: [], en: [], registry: [] });
    expect(readLegalTexts(legalDir({ "cgu/.gitkeep": "" }))).toEqual({ fr: [], en: [], registry: [] });
  });

  it.each([
    ["no approved_by", cguFr.replace("approved_by: Camille Martin\n", ""), /cgu\/2026-12-01\.fr\.md: approved_by is missing: the product owner who signs the version/],
    ["no change", cguFr.replace("change: substantielle\n", ""), /cgu\/2026-12-01\.fr\.md: change must be substantielle or mineure/],
    ["a change of another kind", cguFr.replace("change: substantielle", "change: majeure"), /cgu\/2026-12-01\.fr\.md: change must be substantielle or mineure/],
    ["no title", cguFr.replace("title: Conditions générales d'utilisation\n", ""), /cgu\/2026-12-01\.fr\.md: title is missing/],
    ["no history line", cguFr.replace("summary: Première version des conditions d'utilisation.\n", ""), /cgu\/2026-12-01\.fr\.md: summary is missing: the version's line in the version history/],
    ["an effective date other than its file's name", cguFr.replace("effective: 2026-12-01", "effective: 2026-12-02"), /cgu\/2026-12-01\.fr\.md: effective 2026-12-02 differs from the file's name: a version is named after its effective date/],
    ["no section", cguFr.slice(0, cguFr.indexOf("## Objet")), /cgu\/2026-12-01\.fr\.md: it has no section/],
    ["text before the first section", cguFr.replace("## En bref", "Bonjour.\n\n## En bref"), /cgu\/2026-12-01\.fr\.md: text before the first section/],
    ["a missing anchor the other decisions link to", cguFr.replace(" {#invite}", ""), /cgu\/2026-12-01\.fr\.md: no section is anchored #invite/],
    ["the same anchor twice", cguFr.replace("## Objet", "## Objet {#invite}"), /cgu\/2026-12-01\.fr\.md: #invite anchors two sections/],
  ])("refuses a French file with %s, naming it", (_case, markdown, problem) => {
    expect(() => readLegalTexts(legalDir({ ...cgu, "cgu/2026-12-01.fr.md": markdown }))).toThrow(problem);
  });

  it("refuses the privacy policy without its cookies and AI sections, and the CGV without the withdrawal form", () => {
    expect(() =>
      readLegalTexts(legalDir({ "confidentialite/2026-12-01.fr.md": privacyFr.replace(" {#ia}", ""), "confidentialite/2026-12-01.en.md": privacyEn })),
    ).toThrow(/confidentialite\/2026-12-01\.fr\.md: no section is anchored #ia/);
    const cgv = cguFr.replace("title: Conditions générales d'utilisation", "title: Conditions générales de vente").replace(" {#invite}", "");
    expect(() => readLegalTexts(legalDir({ "cgv/2026-12-01.fr.md": cgv, "cgv/2026-12-01.en.md": cgv }))).toThrow(
      /cgv\/2026-12-01\.fr\.md: no section is anchored #retractation/,
    );
  });

  it("reads the Tools outside the EU each privacy policy version names (#548)", () => {
    const texts = readLegalTexts(legalDir({ "confidentialite/2026-12-01.fr.md": privacyFr, "confidentialite/2026-12-01.en.md": privacyEn }));
    expect(texts.fr[0]?.recipientsOutsideEu).toEqual(["anthropic", "stripe"]);
    expect(texts.en[0]?.recipientsOutsideEu).toEqual(["anthropic", "stripe"]);
    const none = (markdown: string) => markdown.replace("[anthropic, stripe]", "[]");
    expect(readLegalTexts(legalDir({ "confidentialite/2026-12-01.fr.md": none(privacyFr), "confidentialite/2026-12-01.en.md": none(privacyEn) })).fr[0]?.recipientsOutsideEu).toEqual([]);
  });

  it.each([
    ["an id no Tool has", privacyFr.replace("[anthropic, stripe]", "[anthropic, deepl]"), /confidentialite\/2026-12-01\.fr\.md: recipients_outside_eu names deepl, which is no Tool of the catalog \(packages\/shared\/src\/tools\.ts\)/],
    ["no recipients_outside_eu", privacyFr.replace("recipients_outside_eu: [anthropic, stripe]\n", ""), /confidentialite\/2026-12-01\.fr\.md: recipients_outside_eu is missing: the Tools outside the EU this version names, \[\] for none/],
    ["recipients_outside_eu that is not a list", privacyFr.replace("[anthropic, stripe]", "anthropic"), /confidentialite\/2026-12-01\.fr\.md: recipients_outside_eu is a list: \[anthropic, stripe\]/],
  ])("refuses a privacy policy with %s", (_case, markdown, problem) => {
    expect(() => readLegalTexts(legalDir({ "confidentialite/2026-12-01.fr.md": markdown, "confidentialite/2026-12-01.en.md": privacyEn }))).toThrow(problem);
  });

  it("refuses recipients_outside_eu outside the privacy policy, and a translation naming other Tools than the French text", () => {
    expect(() => readLegalTexts(legalDir({ ...cgu, "cgu/2026-12-01.fr.md": cguFr.replace("---\n## En bref", "recipients_outside_eu: [anthropic]\n---\n## En bref") }))).toThrow(
      /cgu\/2026-12-01\.fr\.md: only the privacy policy names recipients_outside_eu/,
    );
    expect(() => readLegalTexts(legalDir({ "confidentialite/2026-12-01.fr.md": privacyFr, "confidentialite/2026-12-01.en.md": privacyEn.replace("[anthropic, stripe]", "[anthropic]") }))).toThrow(
      /confidentialite\/2026-12-01\.en\.md: its recipients_outside_eu \(anthropic\) differ from the French one's \(anthropic, stripe\)/,
    );
  });

  it.each([
    ["a text that is not a Legal Text", "conditions-utilisation/2026-12-01.fr.md", /conditions-utilisation\/2026-12-01\.fr\.md: conditions-utilisation is not one of cgu, cgv, confidentialite, mentions-legales/],
    ["a file not named after its effective date and language", "cgu/3.2.md", /cgu\/3\.2\.md: a version's file is named <effective date>\.<fr\|en>\.md: 2026-12-01\.fr\.md/],
  ])("refuses %s", (_case, file, problem) => {
    expect(() => readLegalTexts(legalDir({ ...cgu, [file]: cguFr }))).toThrow(problem);
  });

  it("refuses an English translation without its French text, and a French text without its translation", () => {
    expect(() => readLegalTexts(legalDir({ "cgu/2026-12-01.en.md": cguEn }))).toThrow(/cgu\/2026-12-01\.fr\.md is missing: French is the binding text, English its translation/);
    expect(() => readLegalTexts(legalDir({ "cgu/2026-12-01.fr.md": cguFr }))).toThrow(/cgu\/2026-12-01\.en\.md is missing: every version is translated into English/);
  });

  it("refuses a translation whose effective date or change differs from the French text's", () => {
    expect(() => readLegalTexts(legalDir({ ...cgu, "cgu/2026-12-01.en.md": cguEn.replace("effective: 2026-12-01", "effective: 2026-12-02") }))).toThrow(
      /cgu\/2026-12-01\.en\.md: effective 2026-12-02 differs from the file's name/,
    );
    expect(() => readLegalTexts(legalDir({ ...cgu, "cgu/2026-12-01.en.md": cguEn.replace("change: substantielle", "change: mineure") }))).toThrow(
      /cgu\/2026-12-01\.en\.md: its change mineure differs from the French one \(substantielle\)/,
    );
  });
});

describe("this package's Legal Text Versions", () => {
  it("are all valid, in French and English", () => {
    expect(() => readLegalTexts()).not.toThrow();
  });

  it("are the ones the app bundles: legal-texts.generated.ts is rebuilt from them (npm run build -w @jobhub/help)", () => {
    expect(readFileSync(legalTextsModulePath, "utf8")).toBe(renderLegalTextsModule(readLegalTexts()));
  });
});
