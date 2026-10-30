import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HelpContentError } from "./content";
import { readReleaseNotes, releaseNotesModulePath, renderReleaseNotesModule } from "./release-notes-content";

/** Writes `files` ({ "fr/0.2.0.md": "…" }) into a fresh releases directory. */
function releasesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  mkdirSync(path.join(dir, "fr"));
  mkdirSync(path.join(dir, "en"));
  for (const [file, markdown] of Object.entries(files)) writeFileSync(path.join(dir, file), markdown);
  return dir;
}

const fr020 = `---
version: 0.2.0
date: 2026-11-12
title: Entreprises cibles sur votre profil
tags: [candidature, coach-ia]
image: 0.2.0-entreprises.png
image-alt: La liste des entreprises cibles d'un profil
announce: true
---
Listez les entreprises qui vous intéressent : votre coach les surveille.

## Nouveau
- Les **entreprises cibles** sur la page du profil.

## Amélioré
- Le Match Score explique ce qui manque.
- Le Job Digest arrive plus tôt.

## Corrigé
- Le Job Digest ne répète plus une offre déjà enregistrée.
`;
const en020 = `---
version: 0.2.0
date: 2026-11-12
title: Target companies on your profile
tags: [candidature, coach-ia]
image: 0.2.0-entreprises.png
image-alt: A profile's list of target companies
announce: true
---
List the companies you care about: your coach watches them.

## New
- **Target companies** on the profile's page.

## Improved
- The Match Score explains what is missing.
- The Job Digest comes earlier.

## Fixed
- The Job Digest no longer repeats a saved offer.
`;

describe("readReleaseNotes — the Release Notes of a directory", () => {
  it("reads each Release Note in French and English: its front matter, introduction and change lines", () => {
    const notes = readReleaseNotes(releasesDir({ "fr/0.2.0.md": fr020, "en/0.2.0.md": en020 }));

    expect(notes.fr).toEqual([
      {
        version: "0.2.0",
        locale: "fr",
        date: "2026-11-12",
        title: "Entreprises cibles sur votre profil",
        tags: ["candidature", "coach-ia"],
        image: { file: "0.2.0-entreprises.png", alt: "La liste des entreprises cibles d'un profil" },
        announce: true,
        intro: "Listez les entreprises qui vous intéressent : votre coach les surveille.",
        changes: [
          { kind: "new", text: "Les **entreprises cibles** sur la page du profil." },
          { kind: "improved", text: "Le Match Score explique ce qui manque." },
          { kind: "improved", text: "Le Job Digest arrive plus tôt." },
          { kind: "fixed", text: "Le Job Digest ne répète plus une offre déjà enregistrée." },
        ],
      },
    ]);
    expect(notes.en[0]).toMatchObject({ locale: "en", title: "Target companies on your profile", changes: expect.arrayContaining([{ kind: "fixed", text: "The Job Digest no longer repeats a saved offer." }]) });
  });

  it("has no image and no announce when the front matter leaves them out", () => {
    const plain = (markdown: string) => markdown.replace(/image: .*\n/, "").replace(/image-alt: .*\n/, "").replace("announce: true\n", "");
    const notes = readReleaseNotes(releasesDir({ "fr/0.2.0.md": plain(fr020), "en/0.2.0.md": plain(en020) }));
    expect(notes.fr[0]).toMatchObject({ image: null, announce: false });
  });

  it("reads nothing from a directory with no Release Note yet, or none at all", () => {
    expect(readReleaseNotes(releasesDir({}))).toEqual({ fr: [], en: [] });
    expect(readReleaseNotes(path.join(tmpdir(), "no-such-releases-dir"))).toEqual({ fr: [], en: [] });
  });

  it("fails when a Release Note has no English twin, or no French one", () => {
    expect(() => readReleaseNotes(releasesDir({ "fr/0.2.0.md": fr020 }))).toThrow(
      new HelpContentError("en/0.2.0.md is missing: every Release Note is written in French and in English"),
    );
    expect(() => readReleaseNotes(releasesDir({ "en/0.2.0.md": en020 }))).toThrow(/fr\/0\.2\.0\.md is missing/);
  });

  it.each([
    ["a file not named after a Version", "fr/next.md", fr020, /fr\/next\.md: the file is named after its Version: X\.Y\.Z\.md/],
    ["a version that is not its file's", "fr/0.2.0.md", fr020.replace("version: 0.2.0", "version: 0.3.0"), /fr\/0\.2\.0\.md: version 0\.3\.0 is not the file's \(0\.2\.0\)/],
    ["a date that is not a day", "fr/0.2.0.md", fr020.replace("2026-11-12", "12 novembre"), /fr\/0\.2\.0\.md: date must be a day: YYYY-MM-DD/],
    ["no title", "fr/0.2.0.md", fr020.replace("title: Entreprises cibles sur votre profil", ""), /fr\/0\.2\.0\.md: title is missing/],
    ["an unknown tag", "fr/0.2.0.md", fr020.replace("coach-ia", "blog"), /fr\/0\.2\.0\.md: tag blog is not one of candidature, /],
    ["an image without its words", "fr/0.2.0.md", fr020.replace(/image-alt: .*\n/, ""), /fr\/0\.2\.0\.md: an image needs its words: image-alt/],
    ["an unknown section", "fr/0.2.0.md", fr020.replace("## Corrigé", "## Divers"), /fr\/0\.2\.0\.md: section « Divers » is not one of Nouveau, Amélioré, Corrigé/],
    ["no introduction", "fr/0.2.0.md", fr020.replace("Listez les entreprises qui vous intéressent : votre coach les surveille.\n", ""), /fr\/0\.2\.0\.md: the introduction is missing/],
  ])("fails on %s, naming the file", (_case, file, markdown, problem) => {
    const twin = file.replace("fr/", "en/");
    expect(() => readReleaseNotes(releasesDir({ [file]: markdown, [twin]: en020 }))).toThrow(problem);
  });

  it("fails when the twins' date or tags differ", () => {
    expect(() => readReleaseNotes(releasesDir({ "fr/0.2.0.md": fr020, "en/0.2.0.md": en020.replace("2026-11-12", "2026-11-13") }))).toThrow(
      /en\/0\.2\.0\.md: its date 2026-11-13 differs from the French one \(2026-11-12\)/,
    );
    expect(() => readReleaseNotes(releasesDir({ "fr/0.2.0.md": fr020, "en/0.2.0.md": en020.replace("[candidature, coach-ia]", "[candidature]") }))).toThrow(
      /en\/0\.2\.0\.md: its tags candidature differ from the French ones \(candidature, coach-ia\)/,
    );
  });
});

describe("this package's Release Notes", () => {
  it("are all written in French and English, with valid front matter", () => {
    expect(() => readReleaseNotes()).not.toThrow();
  });

  it("are the ones the app bundles: release-notes.generated.ts is rebuilt from them (npm run build -w @jobhub/help)", () => {
    expect(readFileSync(releaseNotesModulePath, "utf8")).toBe(renderReleaseNotesModule(readReleaseNotes()));
  });
});
