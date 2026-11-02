import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HelpContentError } from "./content";
import {
  assembleReleaseNote,
  describeReleaseNoteStatus,
  readReleaseNoteFragments,
  releaseNoteStatus,
  renderReleaseNote,
} from "./release-note-fragments";
import { readReleaseNotes } from "./release-notes-content";

/** Writes `files` ({ "unreleased/601.md": "…" }) into a fresh releases directory. */
function releasesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-fragments-"));
  for (const sub of ["fr", "en", "unreleased"]) mkdirSync(path.join(dir, sub));
  for (const [file, markdown] of Object.entries(files)) writeFileSync(path.join(dir, file), markdown);
  return dir;
}

const fragment = ({ kind = "new", tags = "[candidature]", extra = "", fr = "- Une ligne.", en = "- One line." } = {}) =>
  `---\nkind: ${kind}\ntags: ${tags}\n${extra}---\n<!-- PR #601 -->\n\n## fr\n${fr}\n\n## en\n${en}\n`;

const three = {
  "unreleased/601.md": fragment({ fr: "- Les **entreprises cibles** sur la page du profil.", en: "- **Target companies** on the profile's page." }),
  "unreleased/603.md": fragment({ kind: "fixed", tags: "[]", fr: "- Le Job Digest ne répète plus une offre\n  déjà enregistrée.", en: "- The Job Digest no longer repeats a saved offer." }),
  "unreleased/602.md": fragment({
    kind: "improved",
    tags: "[coach-ia]",
    extra: "announce: true\n",
    fr: "- Le Match Score explique ce qui manque.\n- Le Job Digest arrive plus tôt.",
    en: "- The Match Score explains what is missing.\n- The Job Digest comes earlier.",
  }),
};

describe("readReleaseNoteFragments — the fragments waiting in releases/unreleased/", () => {
  it("reads each fragment's kind, tags, announce and lines, by pull request", () => {
    expect(readReleaseNoteFragments(releasesDir(three))).toEqual([
      { file: "601.md", pr: 601, kind: "new", tags: ["candidature"], announce: false, lines: { fr: ["Les **entreprises cibles** sur la page du profil."], en: ["**Target companies** on the profile's page."] } },
      {
        file: "602.md",
        pr: 602,
        kind: "improved",
        tags: ["coach-ia"],
        announce: true,
        lines: { fr: ["Le Match Score explique ce qui manque.", "Le Job Digest arrive plus tôt."], en: ["The Match Score explains what is missing.", "The Job Digest comes earlier."] },
      },
      { file: "603.md", pr: 603, kind: "fixed", tags: [], announce: false, lines: { fr: ["Le Job Digest ne répète plus une offre déjà enregistrée."], en: ["The Job Digest no longer repeats a saved offer."] } },
    ]);
  });

  it("reads nothing when there is no fragment, or no unreleased/ at all", () => {
    expect(readReleaseNoteFragments(releasesDir({}))).toEqual([]);
    expect(readReleaseNoteFragments(path.join(tmpdir(), "no-such-releases-dir"))).toEqual([]);
  });

  it.each([
    ["no English line", fragment({ en: "" }), "unreleased/601.md: its en line is missing: every fragment is written in French and in English"],
    ["no French line", fragment({ fr: "" }), "unreleased/601.md: its fr line is missing"],
    ["a tag outside the list", fragment({ tags: "[candidature, blog]" }), "unreleased/601.md: tag blog is not one of candidature, extension, coach-ia, confidentialite, accessibilite"],
    ["tags that are no list", fragment({ tags: "candidature" }), "unreleased/601.md: tags must be a list"],
    ["an unknown kind", fragment({ kind: "divers" }), "unreleased/601.md: kind must be one of new, improved, fixed"],
    ["an announce that is no boolean", fragment({ extra: "announce: oui\n" }), "unreleased/601.md: announce is true or false"],
    ["no front matter", "## fr\n- Une ligne.\n\n## en\n- One line.\n", "unreleased/601.md: the front matter is missing"],
    ["an unknown section", fragment().replace("## en", "## English"), "unreleased/601.md: section « English » is not one of fr, en"],
    ["a line that is no list item", fragment({ fr: "Une ligne." }), "unreleased/601.md: ## fr: a line is a list item"],
    ["more French lines than English ones", fragment({ fr: "- Une.\n- Deux." }), "unreleased/601.md: 2 French lines but 1 English ones"],
  ])("refuses %s, naming the file", (_case, markdown, problem) => {
    expect(() => readReleaseNoteFragments(releasesDir({ "unreleased/601.md": markdown }))).toThrow(problem);
  });

  it("refuses a file not named after its pull request, and lists every problem at once", () => {
    const run = () => readReleaseNoteFragments(releasesDir({ "unreleased/entreprises.md": fragment(), "unreleased/602.md": fragment({ en: "" }) }));
    expect(run).toThrow(HelpContentError);
    expect(run).toThrow(/unreleased\/602\.md: its en line is missing[\s\S]*unreleased\/entreprises\.md: a fragment is named after its pull request/);
  });

  it("accepts a second fragment of the same pull request: <pr>-<n>.md", () => {
    expect(readReleaseNoteFragments(releasesDir({ "unreleased/601-2.md": fragment({ kind: "fixed" }), "unreleased/601.md": fragment() })).map((each) => each.file)).toEqual([
      "601-2.md",
      "601.md",
    ]);
  });
});

describe("assembleReleaseNote — npm run release-note -w @jobhub/help", () => {
  it("writes the next Version's draft in French and in English from three fragments, grouped by kind, and removes them", () => {
    const dir = releasesDir(three);
    const assembly = assembleReleaseNote({ dir, version: "0.2.0", date: "2026-11-12" });

    expect(assembly).toEqual({ version: "0.2.0", fragments: ["601.md", "602.md", "603.md"], written: ["fr/0.2.0.md", "en/0.2.0.md"], toWrite: true });
    expect(readdirSync(path.join(dir, "unreleased"))).toEqual([]);
    expect(readFileSync(path.join(dir, "fr", "0.2.0.md"), "utf8")).toBe(`---
version: 0.2.0
date: 2026-11-12
title: À écrire
tags: [candidature, coach-ia]
announce: true
---
À écrire

## Nouveau
- Les **entreprises cibles** sur la page du profil.

## Amélioré
- Le Match Score explique ce qui manque.
- Le Job Digest arrive plus tôt.

## Corrigé
- Le Job Digest ne répète plus une offre déjà enregistrée.
`);
    expect(readFileSync(path.join(dir, "en", "0.2.0.md"), "utf8")).toContain("title: To be written\ntags: [candidature, coach-ia]\nannounce: true\n---\nTo be written\n\n## New\n- **Target companies** on the profile's page.\n\n## Improved\n");
  });

  it("leaves a draft the build refuses until its title and introduction are written, then accepts it", () => {
    const dir = releasesDir(three);
    assembleReleaseNote({ dir, version: "0.2.0", date: "2026-11-12" });
    expect(() => readReleaseNotes(dir)).toThrow(/fr\/0\.2\.0\.md: the draft's title and introduction are still to write \(« À écrire »\)[\s\S]*en\/0\.2\.0\.md: the draft's title/);

    for (const [locale, placeholder, title] of [["fr", "À écrire", "Entreprises cibles"], ["en", "To be written", "Target companies"]] as const) {
      const file = path.join(dir, locale, "0.2.0.md");
      writeFileSync(file, readFileSync(file, "utf8").replace(`title: ${placeholder}`, `title: ${title}`).replace(`---\n${placeholder}\n`, "---\nIntroduction.\n"));
    }
    const notes = readReleaseNotes(dir);
    expect(notes.fr[0]).toMatchObject({ title: "Entreprises cibles", changes: expect.arrayContaining([{ kind: "fixed", text: "Le Job Digest ne répète plus une offre déjà enregistrée." }]) });
    expect(notes.en[0]!.changes).toHaveLength(4);
  });

  it("adds to the next Version's Release Note when it exists, keeping its title, introduction, date and image", () => {
    const written = (locale: "fr" | "en", title: string, section: string) =>
      `---\nversion: 0.2.0\ndate: 2026-11-10\ntitle: ${title}\ntags: [extension]\nimage: 0.2.0.png\nimage-alt: ${title}\nannounce: false\n---\nDéjà écrite.\n\n## ${section}\n- Déjà là.\n`;
    const dir = releasesDir({ ...three, "fr/0.2.0.md": written("fr", "Titre", "Nouveau"), "en/0.2.0.md": written("en", "Title", "New") });
    expect(assembleReleaseNote({ dir, version: "0.2.0", date: "2026-11-12" }).toWrite).toBe(false);
    const fr = readReleaseNotes(dir).fr[0]!;
    expect(fr).toMatchObject({ date: "2026-11-10", title: "Titre", intro: "Déjà écrite.", image: { file: "0.2.0.png", alt: "Titre" }, tags: ["candidature", "extension", "coach-ia"], announce: true });
    expect(fr.changes.map((change) => change.text)).toEqual([
      "Déjà là.",
      "Les **entreprises cibles** sur la page du profil.",
      "Le Match Score explique ce qui manque.",
      "Le Job Digest arrive plus tôt.",
      "Le Job Digest ne répète plus une offre déjà enregistrée.",
    ]);
  });

  it("writes nothing when there is no fragment", () => {
    const dir = releasesDir({});
    expect(assembleReleaseNote({ dir, version: "0.2.0", date: "2026-11-12" })).toEqual({ version: "0.2.0", fragments: [], written: [], toWrite: false });
    expect(existsSync(path.join(dir, "fr", "0.2.0.md"))).toBe(false);
  });

  it("writes and removes nothing when a fragment is invalid", () => {
    const dir = releasesDir({ ...three, "unreleased/604.md": fragment({ en: "" }) });
    expect(() => assembleReleaseNote({ dir, version: "0.2.0", date: "2026-11-12" })).toThrow(/unreleased\/604\.md: its en line is missing/);
    expect(readdirSync(path.join(dir, "unreleased"))).toHaveLength(4);
    expect(existsSync(path.join(dir, "fr", "0.2.0.md"))).toBe(false);
  });

  it("renders a Release Note as readReleaseNotes reads it back", () => {
    const dir = releasesDir({});
    const note = { version: "0.2.0", locale: "fr" as const, date: "2026-11-12", title: "T", tags: [], image: null, announce: false, intro: "I.", changes: [{ kind: "fixed" as const, text: "Corrigé." }] };
    writeFileSync(path.join(dir, "fr", "0.2.0.md"), renderReleaseNote(note));
    writeFileSync(path.join(dir, "en", "0.2.0.md"), renderReleaseNote({ ...note, locale: "en", changes: [{ kind: "fixed", text: "Fixed." }] }));
    expect(readReleaseNotes(dir).fr).toEqual([note]);
  });
});

describe("releaseNoteStatus — what the deploy-staging report says, without blocking", () => {
  const note = "---\nversion: 0.2.0\ndate: 2026-11-12\ntitle: T\ntags: []\n---\nI.\n";

  it.each([
    [{ "fr/0.2.0.md": note, "en/0.2.0.md": note }, "Release Note 0.2.0 : écrite en français et en anglais ; aucun fragment en attente."],
    [{ "fr/0.2.0.md": note, "en/0.2.0.md": note, "unreleased/601.md": fragment() }, "Release Note 0.2.0 : écrite en français et en anglais ; 1 fragment en attente dans releases/unreleased/."],
    [three, "Release Note 0.2.0 : pas encore assemblée (fr et en manquant) ; 3 fragments en attente dans releases/unreleased/, à assembler avant la Promotion (npm run release-note -w @jobhub/help)."],
    [{}, "Release Note 0.2.0 : absente (fr et en) et aucun fragment en attente. À écrire avant la Promotion, sauf si rien de visible pour un Candidat n'a changé (--rien-de-visible)."],
  ])("%#", (files, sentence) => {
    expect(describeReleaseNoteStatus(releaseNoteStatus({ dir: releasesDir(files), version: "0.2.0" }))).toBe(sentence);
  });
});

describe("this package's fragments", () => {
  it("are all valid: FR and EN, a known kind and tags", () => {
    expect(() => readReleaseNoteFragments()).not.toThrow();
  });
});
