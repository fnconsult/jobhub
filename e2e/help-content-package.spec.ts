import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issue #347: the Help Articles package (`@jobhub/help`). Observed through its public entry point in a fresh
// process (e2e/support/help-harness.ts, run from apps/web as the web app resolves it), through the package's
// `build` script, and through `npm test` itself for the missing-translation rule.

const root = path.resolve(".");
const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/help-harness.ts");
const helpDir = path.resolve("packages/help");
const generated = path.join(helpDir, "src", "articles.generated.ts");

interface Result { results: string[][]; counts: { fr: number; en: number }; homeKind: string | null; perSearchMs: number }

function load(queries: [string, "fr" | "en"][]): Result {
  const run = spawnSync(tsx, [harness, JSON.stringify(queries)], { cwd: path.resolve("apps/web"), encoding: "utf8", timeout: 60_000 });
  const line = run.stdout.split("\n").find((l) => l.startsWith("HELP_RESULT "));
  if (!line) throw new Error(`harness failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line.slice("HELP_RESULT ".length)) as Result;
}

test.describe("@jobhub/help package", () => {
  test("builds, and the bundled articles are the ones the Markdown files give", () => {
    const before = readFileSync(generated, "utf8");
    const build = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { cwd: root, encoding: "utf8", timeout: 120_000 });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    expect(build.stdout).toMatch(/Help Articles: \d+ in French and English/);
    expect(readFileSync(generated, "utf8")).toBe(before);
  });

  test("is imported by apps/web, which depends on it and resolves it", () => {
    const manifest = JSON.parse(readFileSync(path.resolve("apps/web/package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toContain("@jobhub/help");
    expect(readFileSync(path.resolve("apps/web/src/help/candidate-pages.test.ts"), "utf8")).toMatch(/from "@jobhub\/help"/);
    expect(load([]).counts.fr).toBeGreaterThanOrEqual(25);
  });

  test("has no runtime dependency on @jobhub/ai", () => {
    const manifest = JSON.parse(readFileSync(path.join(helpDir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((f) => Object.keys(manifest[f] ?? {}));
    expect(declared).not.toContain("@jobhub/ai");
    const sources = readdirSync(path.join(helpDir, "src"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of sources) expect(readFileSync(path.join(helpDir, "src", file), "utf8"), file).not.toMatch(/@jobhub\/ai/);
  });

  test("every article exists in French and English", () => {
    const names = (locale: string) => readdirSync(path.join(helpDir, "articles", locale)).filter((f) => f.endsWith(".md")).sort();
    expect(names("fr")).toEqual(names("en"));
    const { counts } = load([]);
    expect(counts.fr).toBe(counts.en);
    expect(counts.fr).toBe(names("fr").length);
  });

  // #567: a Tutorial's `motion` names its Motion Script (packages/help/motions), written in French and in English.
  test("the build refuses a Tutorial whose motion names no Motion Script, and a Motion Script without its translation", () => {
    const tutorial = (title: string) =>
      `---\nkind: tutorial\naudience: candidate\ntopic: utiliser\ntitle: ${title}\nsynonyms: [essai]\nmotion: e2e-motion\n---\n1. Ouvrez « Mes candidatures ».\n2. Cliquez sur une candidature.\n`;
    const script = "---\ntitle: Essai\nroutes: [/candidatures]\n---\n## Vos candidatures\n- goto /candidatures\n\nVoici « Mes candidatures ».\n";
    const files = {
      fr: path.join(helpDir, "articles", "fr", "tutorial-e2e-motion.md"),
      en: path.join(helpDir, "articles", "en", "tutorial-e2e-motion.md"),
      scriptFr: path.join(helpDir, "motions", "fr", "e2e-motion.md"),
    };
    const before = readFileSync(generated, "utf8");
    const build = () => spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { cwd: root, encoding: "utf8", timeout: 120_000 });
    try {
      writeFileSync(files.fr, tutorial("Essai de motion"));
      writeFileSync(files.en, tutorial("Motion test"));
      const noScript = build();
      expect(noScript.status).not.toBe(0);
      expect(noScript.stdout + noScript.stderr).toContain("fr/tutorial-e2e-motion.md: its motion e2e-motion names no Motion Script (motions/fr/e2e-motion.md)");

      writeFileSync(files.scriptFr, script);
      const untranslated = build();
      expect(untranslated.status).not.toBe(0);
      expect(untranslated.stdout + untranslated.stderr).toContain("en/e2e-motion.md is missing: every Motion Script is written in French and in English");
      expect(readFileSync(generated, "utf8")).toBe(before);
    } finally {
      for (const file of Object.values(files)) rmSync(file, { force: true });
    }
  });

  // #562: a Release Note fragment (releases/unreleased/<pr>.md) gives its line in French and in English, and only
  // tags of RELEASE_NOTE_TAGS.
  test("the build refuses a Release Note fragment without its English line, or with a tag outside the list", () => {
    const fragment = path.join(helpDir, "releases", "unreleased", "999999.md");
    const releaseNotes = path.join(helpDir, "src", "release-notes.generated.ts");
    const before = readFileSync(releaseNotes, "utf8");
    const articles = readFileSync(generated, "utf8");
    const build = () => spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { cwd: root, encoding: "utf8", timeout: 120_000 });
    try {
      writeFileSync(fragment, "---\nkind: new\ntags: [candidature]\n---\n## fr\n- Une ligne pour les Candidats.\n");
      const noEnglish = build();
      expect(noEnglish.status).not.toBe(0);
      expect(noEnglish.stdout + noEnglish.stderr).toContain("unreleased/999999.md: its en line is missing: every fragment is written in French and in English");

      writeFileSync(fragment, "---\nkind: new\ntags: [blog]\n---\n## fr\n- Une ligne pour les Candidats.\n\n## en\n- A line for Candidates.\n");
      const unknownTag = build();
      expect(unknownTag.status).not.toBe(0);
      expect(unknownTag.stdout + unknownTag.stderr).toContain("unreleased/999999.md: tag blog is not one of candidature, extension, coach-ia, confidentialite, accessibilite, recherche");
      // Refused before anything is written.
      expect(readFileSync(generated, "utf8")).toBe(articles);

      writeFileSync(fragment, "---\nkind: new\ntags: [candidature]\n---\n## fr\n- Une ligne pour les Candidats.\n\n## en\n- A line for Candidates.\n");
      const valid = build();
      expect(valid.status, valid.stdout + valid.stderr).toBe(0);
      expect(valid.stdout).toMatch(/Release Note fragments: \d+ waiting in releases\/unreleased\//);
      expect(readFileSync(releaseNotes, "utf8")).toBe(before);
    } finally {
      rmSync(fragment, { force: true });
    }
  });

  test("a missing translation fails npm test", () => {
    const victim = path.join(helpDir, "articles", "en", "faq-text-size.md");
    const hidden = `${victim}.hidden`;
    expect(existsSync(victim)).toBe(true);
    renameSync(victim, hidden);
    try {
      const run = spawnSync("npm", ["test", "--", "packages/help/src/content.test.ts"], { cwd: root, encoding: "utf8", timeout: 180_000 });
      expect(run.status, run.stdout + run.stderr).not.toBe(0);
      expect(run.stdout + run.stderr).toContain("en/faq-text-size.md is missing");
    } finally {
      renameSync(hidden, victim);
    }
  });

  test("search finds the right article, in the right language, and nothing for what no article answers", () => {
    const { results } = load([
      ["comment relancer le recruteur", "fr"],
      ["négocier mon salaire", "fr"],
      ["Comment rélancer le récruteur", "fr"],
      ["how do I follow up with the recruiter", "en"],
      ["quand se renouvelle mon quota", "fr"],
      ["comment le la de un je", "fr"],
    ]);
    expect(results[0]![0]).toBe("faq-follow-up-recruiter");
    expect(results[1]).toEqual([]);
    expect(results[2]).toEqual(results[0]);
    expect(results[3]![0]).toBe("faq-follow-up-recruiter");
    expect(results[4]![0]).toBe("faq-quota-renewal");
    expect(results[5]).toEqual([]);
  });

  test("searches all the articles in under 5 ms", () => {
    expect(load([]).perSearchMs).toBeLessThan(5);
  });
});
