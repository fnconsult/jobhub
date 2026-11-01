import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalChangesSince, legalImmutabilityViolations } from "./legal-immutability";

const today = "2026-10-30";
const file = (name: string) => `packages/help/legal/cgu/${name}`;

describe("legalImmutabilityViolations — a pull request never edits a Legal Text Version in effect", () => {
  it("refuses a change to, or the deletion of, a version whose effective date is reached", () => {
    expect(
      legalImmutabilityViolations(
        [
          { status: "M", path: file("2026-10-12.fr.md") },
          { status: "D", path: file("2026-06-01.en.md") },
          { status: "M", path: file("2026-10-30.fr.md") },
        ],
        today,
      ),
    ).toEqual([
      "packages/help/legal/cgu/2026-10-12.fr.md is changed, but it took effect on 2026-10-12: a correction is a new version",
      "packages/help/legal/cgu/2026-06-01.en.md is deleted, but it took effect on 2026-06-01: a correction is a new version",
      "packages/help/legal/cgu/2026-10-30.fr.md is changed, but it took effect on 2026-10-30: a correction is a new version",
    ]);
  });

  it("refuses a version in effect renamed away, and a new version that would take effect in the past", () => {
    expect(
      legalImmutabilityViolations(
        [
          { status: "R", path: file("2026-12-01.fr.md"), from: file("2026-10-12.fr.md") },
          { status: "A", path: file("2026-10-29.fr.md") },
        ],
        today,
      ),
    ).toEqual([
      "packages/help/legal/cgu/2026-10-12.fr.md is deleted, but it took effect on 2026-10-12: a correction is a new version",
      "packages/help/legal/cgu/2026-10-29.fr.md is added, but its effective date 2026-10-29 is past: a new version takes effect today at the earliest",
    ]);
  });

  it("lets a pull request add a version from today on, and change a version still to come", () => {
    expect(
      legalImmutabilityViolations(
        [
          { status: "A", path: file("2026-10-30.fr.md") },
          { status: "A", path: file("2026-12-01.en.md") },
          { status: "M", path: file("2026-12-01.fr.md") },
          { status: "D", path: "packages/help/legal/cgu/.gitkeep" },
          { status: "M", path: "packages/help/articles/fr/faq-legal.md" },
        ],
        today,
      ),
    ).toEqual([]);
  });
});

describe("legalImmutabilityViolations — a substantial version is merged 30 days before it takes effect (#547)", () => {
  it("refuses a substantial version of the CGU, CGV or privacy policy effective less than 30 days after today, with the first possible date", () => {
    expect(
      legalImmutabilityViolations(
        [
          { status: "A", path: file("2026-11-19.fr.md"), change: "substantielle" },
          { status: "R", path: "packages/help/legal/confidentialite/2026-11-28.fr.md", from: "packages/help/legal/confidentialite/2027-01-01.fr.md", change: "substantielle" },
          { status: "M", path: "packages/help/legal/cgv/2026-11-01.en.md", change: "substantielle" },
        ],
        today,
      ),
    ).toEqual([
      "packages/help/legal/cgu/2026-11-19.fr.md is a substantial change effective on 2026-11-19: Candidates are emailed 30 days before, so it takes effect on 2026-11-29 at the earliest",
      "packages/help/legal/confidentialite/2026-11-28.fr.md is a substantial change effective on 2026-11-28: Candidates are emailed 30 days before, so it takes effect on 2026-11-29 at the earliest",
      "packages/help/legal/cgv/2026-11-01.en.md is a substantial change effective on 2026-11-01: Candidates are emailed 30 days before, so it takes effect on 2026-11-29 at the earliest",
    ]);
  });

  it("lets a substantial version 30 days ahead or more, a minor one at once, and the legal notice through", () => {
    expect(
      legalImmutabilityViolations(
        [
          { status: "A", path: file("2026-11-29.fr.md"), change: "substantielle" },
          { status: "A", path: file("2026-11-30.en.md"), change: "substantielle" },
          { status: "A", path: file("2026-10-30.fr.md"), change: "mineure" },
          { status: "A", path: "packages/help/legal/mentions-legales/2026-11-02.fr.md", change: "substantielle" },
        ],
        today,
      ),
    ).toEqual([]);
  });
});

describe("legalChangesSince — what a pull request changes in packages/help/legal, read from git", () => {
  it("lists the added, changed, deleted and renamed files since the base", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "legal-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    const write = (name: string, text: string) => {
      mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
      writeFileSync(path.join(repo, name), text);
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    write(file("2026-06-01.fr.md"), "Première version, assez longue pour être reconnue quand elle est renommée.\n".repeat(5));
    write(file("2026-10-12.fr.md"), "Deuxième version.\n");
    write(file("2026-10-12.en.md"), "Second version.\n");
    write("README.md", "Jobbbox\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write(file("2026-10-12.fr.md"), "Deuxième version, corrigée.\n");
    rmSync(path.join(repo, file("2026-10-12.en.md")));
    git("mv", file("2026-06-01.fr.md"), file("2026-12-01.fr.md"));
    write(file("2027-01-01.fr.md"), "---\ntitle: CGU\nchange: substantielle\n---\n## Objet\nTroisième version.\n");
    write("README.md", "Jobbbox, changé\n");
    git("add", "-A");
    git("commit", "-q", "-m", "head");

    expect(legalChangesSince("HEAD^1", repo)).toEqual([
      { status: "D", path: file("2026-10-12.en.md") },
      { status: "M", path: file("2026-10-12.fr.md") },
      { status: "R", path: file("2026-12-01.fr.md"), from: file("2026-06-01.fr.md") },
      { status: "A", path: file("2027-01-01.fr.md"), change: "substantielle" },
    ]);
  });
});

describe("CI runs the check on the day of the merge on main, not only on the pull request (#547)", () => {
  // A pull request checked on day 0 with a version effective on day 31, merged on day 10 with no new push, must still be
  // refused: the 30 days count from the merge on main. Merges are squashed, so on main HEAD^1 is main before the merge.
  const ci = readFileSync(path.resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");
  const steps = ci.split(/\n(?= {6}- )/);
  const check = steps.filter((step) => step.includes("check-legal-immutability.ts"));

  it("runs on push to main and on pull requests", () => {
    expect(ci).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/);
  });

  it("runs its step on every event, against the commit before HEAD", () => {
    expect(check).toHaveLength(1);
    expect(check[0]).not.toMatch(/^\s*-?\s*if:/m);
    expect(check[0]).toContain("check-legal-immutability.ts HEAD^1");
  });
});
