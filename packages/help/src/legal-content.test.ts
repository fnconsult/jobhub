import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalDocumentsModulePath, readLegalDocuments, renderLegalDocumentsModule } from "./legal-content";

/** Writes `files` ({ "fr/confidentialite/3.2.md": "…" }) into a fresh legal directory. */
function legalDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "legal-"));
  for (const [file, markdown] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), markdown);
  }
  return dir;
}

const privacyFr = `---
title: Politique de confidentialité
effective: 2026-10-12
---
## En bref
- Vos données restent hébergées dans l'Union européenne.
- Vous supprimez tout depuis Mon compte.

## Qui est responsable de vos données
Jobbbox est édité par FN Consult.

Écrivez-nous.

## Ce que nous collectons
- Votre adresse e-mail.
- Vos CV.
`;
const privacyEn = `---
title: Privacy policy
effective: 2026-10-12
---
## In short
- Your data stays in the European Union.

## Who is responsible for your data
Jobbbox is published by FN Consult.

## What we collect
- Your email address.
`;

describe("readLegalDocuments — the Legal Documents of a directory", () => {
  it("reads each version of a Legal Document: its title, effective date, « En bref » and numbered sections", () => {
    const documents = readLegalDocuments(legalDir({ "fr/confidentialite/3.2.md": privacyFr, "en/confidentialite/3.2.md": privacyEn }));

    expect(documents.fr).toEqual([
      {
        id: "confidentialite",
        locale: "fr",
        version: "3.2",
        effective: "2026-10-12",
        title: "Politique de confidentialité",
        summary: ["Vos données restent hébergées dans l'Union européenne.", "Vous supprimez tout depuis Mon compte."],
        sections: [
          { id: "section-1", number: 1, title: "Qui est responsable de vos données", body: "Jobbbox est édité par FN Consult.\n\nÉcrivez-nous." },
          { id: "section-2", number: 2, title: "Ce que nous collectons", body: "- Votre adresse e-mail.\n- Vos CV." },
        ],
      },
    ]);
    expect(documents.en[0]).toMatchObject({ title: "Privacy policy", summary: ["Your data stays in the European Union."] });
  });

  it("keeps every version, newest first", () => {
    const older = privacyFr.replace("2026-10-12", "2026-03-01");
    const documents = readLegalDocuments(
      legalDir({
        "fr/confidentialite/3.2.md": privacyFr,
        "en/confidentialite/3.2.md": privacyEn,
        "fr/confidentialite/3.10.md": privacyFr.replace("2026-10-12", "2026-12-01"),
        "en/confidentialite/3.10.md": privacyEn.replace("2026-10-12", "2026-12-01"),
        "fr/confidentialite/2.0.md": older,
        "en/confidentialite/2.0.md": privacyEn.replace("2026-10-12", "2026-03-01"),
      }),
    );
    expect(documents.fr.map((document) => document.version)).toEqual(["3.10", "3.2", "2.0"]);
  });

  it("has no « En bref » when the document leaves it out", () => {
    const without = (markdown: string, heading: string) => markdown.replace(new RegExp(`## ${heading}\\n(- .*\\n)+\\n`), "");
    const documents = readLegalDocuments(legalDir({ "fr/cookies/1.0.md": without(privacyFr, "En bref"), "en/cookies/1.0.md": without(privacyEn, "In short") }));
    expect(documents.fr[0]).toMatchObject({ id: "cookies", summary: [] });
  });

  it("reads nothing while the team has written no text yet", () => {
    expect(readLegalDocuments(path.join(tmpdir(), "no-such-legal-dir"))).toEqual({ fr: [], en: [] });
  });

  it.each([
    ["a document that is not a Legal Document", "fr/blog/1.0.md", privacyFr, /fr\/blog\/1\.0\.md: blog is not one of conditions-utilisation, /],
    ["a file not named after a version", "fr/confidentialite/latest.md", privacyFr, /fr\/confidentialite\/latest\.md: the file is named after its version: 3\.2\.md/],
    ["an effective date that is not a day", "fr/confidentialite/3.2.md", privacyFr.replace("2026-10-12", "demain"), /fr\/confidentialite\/3\.2\.md: effective must be a day: YYYY-MM-DD/],
    ["no title", "fr/confidentialite/3.2.md", privacyFr.replace("title: Politique de confidentialité", ""), /fr\/confidentialite\/3\.2\.md: title is missing/],
    ["no section", "fr/confidentialite/3.2.md", privacyFr.slice(0, privacyFr.indexOf("## Qui")), /fr\/confidentialite\/3\.2\.md: it has no section/],
    ["text before the first section", "fr/confidentialite/3.2.md", privacyFr.replace("## En bref", "Bonjour.\n\n## En bref"), /fr\/confidentialite\/3\.2\.md: text before the first section/],
  ])("fails on %s, naming the file", (_case, file, markdown, problem) => {
    const twin = file.replace(/^fr\//, "en/");
    expect(() => readLegalDocuments(legalDir({ [file]: markdown, [twin]: privacyEn }))).toThrow(problem);
  });

  it("fails when a version has no English twin, or a different effective date", () => {
    expect(() => readLegalDocuments(legalDir({ "fr/confidentialite/3.2.md": privacyFr }))).toThrow(
      /en\/confidentialite\/3\.2\.md is missing: every Legal Document is written in French and in English/,
    );
    expect(() =>
      readLegalDocuments(legalDir({ "fr/confidentialite/3.2.md": privacyFr, "en/confidentialite/3.2.md": privacyEn.replace("2026-10-12", "2026-10-13") })),
    ).toThrow(/en\/confidentialite\/3\.2\.md: its effective date 2026-10-13 differs from the French one \(2026-10-12\)/);
  });
});

describe("this package's Legal Documents", () => {
  it("are all written in French and English, with valid front matter", () => {
    expect(() => readLegalDocuments()).not.toThrow();
  });

  it("are the ones the app bundles: legal-documents.generated.ts is rebuilt from them (npm run build -w @jobhub/help)", () => {
    expect(readFileSync(legalDocumentsModulePath, "utf8")).toBe(renderLegalDocumentsModule(readLegalDocuments()));
  });
});
