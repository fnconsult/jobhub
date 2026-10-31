import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startServer, type PlanPricesServer } from "./support/plan-prices";

// Issue #546 (ADR-0062): the /legal shell. Each Legal Text Version is a Markdown file the build reads. Driven through
// the public entry points: `npm run build -w @jobhub/help` (the build), `next dev` (HTTP), the CI script
// check-legal-immutability.ts, the PreToolUse hook scripts/hooks/no-legal-merge.mjs, and the package's entry point.
//
// In the root-env project, which runs one spec at a time: it writes fixture versions of the CGU into
// packages/help/legal/cgu/, rebuilds the generated module, and restores both afterwards. No fixture is ever committed.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const legalDir = path.resolve("packages/help/legal");
const cguDir = path.join(legalDir, "cgu");
const generated = path.resolve("packages/help/src/legal-texts.generated.ts");

const version = (locale: "fr" | "en", effective: string, extra: { drop?: string } = {}) => {
  const fields: Record<string, string> = {
    title: locale === "fr" ? "Conditions générales d'utilisation" : "Terms of use",
    effective,
    change: "substantielle",
    approved_by: "Camille Martin",
    summary: locale === "fr" ? `Résumé de la version ${effective}.` : `Summary of version ${effective}.`,
  };
  if (extra.drop) delete fields[extra.drop];
  const front = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n");
  const body =
    locale === "fr"
      ? `## Objet\nTexte français du ${effective}.\n\n## L'extension sans compte {#invite}\n- Rien n'est gardé.\n`
      : `## Purpose\nEnglish text of ${effective}.\n\n## The extension without an account {#invite}\n- Nothing is kept.\n`;
  return `---\n${front}\n---\n${body}`;
};

const OLD = "2025-01-01"; // in effect once, then replaced
const CURRENT = "2026-01-01"; // in effect today
const FUTURE = "2099-01-01"; // not yet in effect
const put = (effective: string, locale: "fr" | "en", markdown = version(locale, effective)) => {
  mkdirSync(cguDir, { recursive: true });
  writeFileSync(path.join(cguDir, `${effective}.${locale}.md`), markdown);
};
const clear = () => {
  rmSync(cguDir, { recursive: true, force: true });
  mkdirSync(cguDir, { recursive: true });
  writeFileSync(path.join(cguDir, ".gitkeep"), "");
};
const build = () => spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });

let savedGenerated = "";
test.describe("Coque /legal (#546)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.beforeAll(() => {
    savedGenerated = readFileSync(generated, "utf8");
    clear();
  });
  test.afterAll(() => {
    clear();
    writeFileSync(generated, savedGenerated);
  });

  test("the build refuses a file without approved_by, without change, or whose French is missing", () => {
    for (const drop of ["approved_by", "change"]) {
      clear();
      put(CURRENT, "fr", version("fr", CURRENT, { drop }));
      put(CURRENT, "en");
      const result = build();
      expect(result.status, `${drop}\n${result.stdout}${result.stderr}`).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(drop === "change" ? "change must be" : "approved_by is missing");
      expect(result.stdout + result.stderr).toContain(`cgu/${CURRENT}.fr.md`);
    }
    clear();
    put(CURRENT, "en"); // the English translation alone
    const noFrench = build();
    expect(noFrench.status, noFrench.stdout + noFrench.stderr).not.toBe(0);
    expect(noFrench.stdout + noFrench.stderr).toContain(`cgu/${CURRENT}.fr.md is missing`);
    // A valid pair builds.
    clear();
    put(CURRENT, "fr");
    put(CURRENT, "en");
    const ok = build();
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
  });

  test("the registry exposes each version's id, URL, the SHA-256 of its French file and its change", () => {
    clear();
    for (const day of [OLD, CURRENT, FUTURE]) {
      put(day, "fr");
      put(day, "en");
    }
    const built = build();
    expect(built.status, built.stdout + built.stderr).toBe(0);
    const script = `import { legalTextRegistry } from "./packages/help/src/index.ts"; console.log(JSON.stringify(legalTextRegistry()));`;
    const read = spawnSync("npx", ["tsx", "-e", script], { encoding: "utf8" });
    expect(read.status, read.stderr).toBe(0);
    const sha = (day: string) => createHash("sha256").update(readFileSync(path.join(cguDir, `${day}.fr.md`))).digest("hex");
    expect(JSON.parse(read.stdout)).toEqual(
      [FUTURE, CURRENT, OLD].map((day) => ({ text: "cgu", version: day, url: `/legal/cgu/${day}`, sha256: sha(day), change: "substantielle" })),
    );
  });

  test.describe("served over HTTP", () => {
    let server: PlanPricesServer;
    test.beforeAll(async () => {
      server = await startServer(546, {}, "dev");
    });
    test.afterAll(() => server?.stop());

    const get = (url: string) => fetch(`${server.origin}${url}`, { redirect: "manual", signal: AbortSignal.timeout(120_000) });

    test("/legal/cgu serves the version in effect, /legal/cgu/<date> the other with its banner, /versions lists them, a future one is not served", async ({ page }) => {
      await page.goto(`${server.origin}/legal/cgu?lang=fr`, { timeout: 120_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.cgu);
      await expect(page.getByText(`Texte français du ${CURRENT}.`)).toBeVisible();
      await expect(page.getByText(fr.legal.archived)).toHaveCount(0);
      await expect(page.getByText(/Approuvé par Camille Martin/)).toBeVisible();

      await page.goto(`${server.origin}/legal/cgu/${OLD}?lang=fr`, { timeout: 120_000 });
      await expect(page.getByText(`Texte français du ${OLD}.`)).toBeVisible();
      await expect(page.getByText(fr.legal.archived)).toBeVisible();
      await expect(page.getByRole("link", { name: fr.legal.seeCurrent })).toHaveAttribute("href", /\/legal\/cgu(\?lang=fr)?$/);

      await page.goto(`${server.origin}/legal/cgu/versions?lang=fr`, { timeout: 120_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.history);
      await expect(page.getByText("Version du", { exact: false })).toHaveCount(2);
      await expect(page.getByText(`Résumé de la version ${CURRENT}.`)).toBeVisible();
      await expect(page.getByText(`Résumé de la version ${OLD}.`)).toBeVisible();
      await expect(page.getByText(FUTURE)).toHaveCount(0);
      await expect(page.getByText(`Résumé de la version ${FUTURE}.`)).toHaveCount(0);

      expect((await get(`/legal/cgu/${FUTURE}`)).status).toBe(404);
    });

    test("/legal/ia, /conditions-utilisation, /cookies, /sous-traitants-et-ia and ?version= redirect", async () => {
      const moves = [
        ["/legal/ia", "/legal/confidentialite#ia"],
        ["/legal/conditions-utilisation", "/legal/cgu"],
        ["/legal/cookies", "/legal/confidentialite#cookies"],
        ["/legal/sous-traitants-et-ia", "/legal/confidentialite#ia"],
        [`/legal/cgu?version=${OLD}`, `/legal/cgu/${OLD}`],
      ];
      for (const [from, to] of moves) {
        const response = await get(from!);
        expect(response.status, from).toBe(308);
        expect(new URL(response.headers.get("location")!, server.origin).href, from).toBe(`${server.origin}${to}`);
      }
    });
  });
});

test.describe("CI and agent guards (#546)", () => {
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  const script = path.resolve("packages/help/scripts/check-legal-immutability.ts");
  const check = (repo: string) => spawnSync("npx", ["tsx", script, "HEAD^1"], { cwd: repo, encoding: "utf8" });

  test("the CI check fails on a pull request that edits a version whose effective date is past, and passes on one that adds a future version", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "legal-ci-"));
    try {
      git(repo, "init", "-q");
      const dir = path.join(repo, "packages/help/legal/cgu");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${CURRENT}.fr.md`), "v1\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "base");

      writeFileSync(path.join(dir, `${FUTURE}.fr.md`), "future\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "adds a future version");
      const allowed = check(repo);
      expect(allowed.status, allowed.stdout + allowed.stderr).toBe(0);

      writeFileSync(path.join(dir, `${CURRENT}.fr.md`), "v1 corrected\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "edits a version in effect");
      const refused = check(repo);
      expect(refused.status, refused.stdout + refused.stderr).toBe(1);
      expect(refused.stderr).toContain(`${CURRENT}.fr.md is changed, but it took effect on ${CURRENT}`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("the hook refuses gh pr merge on a pull request that touches packages/help/legal/, and lets any other through", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "legal-hook-"));
    try {
      // A stand-in `gh`: pull request 901 changes a Legal Text Version, 902 does not.
      const gh = path.join(bin, "gh");
      writeFileSync(gh, `#!/bin/sh\ncase "$*" in\n  *pulls/901/files*) echo packages/help/legal/cgu/2026-12-01.fr.md;;\n  *pulls/902/files*) echo apps/web/src/page.tsx;;\n  *) exit 1;;\nesac\n`);
      chmodSync(gh, 0o755);
      const hook = (command: string) => {
        const result = spawnSync("node", ["scripts/hooks/no-legal-merge.mjs"], {
          input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
      };
      const refused = hook("gh pr merge 901 --squash");
      expect(refused.permissionDecision).toBe("deny");
      expect(refused.permissionDecisionReason).toContain("packages/help/legal/");
      expect(hook("gh api -X PUT repos/fnconsult/jobhub/pulls/901/merge -f merge_method=squash").permissionDecision).toBe("deny");
      expect(hook("gh pr merge 902 --squash")).toBeNull();
      expect(JSON.parse(readFileSync(".claude/settings.json", "utf8")).hooks.PreToolUse[0].hooks[0].command).toContain("no-legal-merge.mjs");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("CONTEXT.md no longer has the term Legal Document", () => {
    expect(readFileSync("CONTEXT.md", "utf8")).not.toContain("Legal Document");
  });
});
