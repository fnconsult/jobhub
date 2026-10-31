import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";

// Issue #548: a recipient outside the EU that the privacy policy in effect does not name warns when switched on
// (covered with its Audit line by sign-in-providers.spec.ts); one in the EU switches on without a warning; and the
// build refuses a recipients_outside_eu naming a Tool the catalog does not have.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const uncovered = fr.admin.tools.uncoveredRecipient;
const SUPER_ADMIN = "recipients-eu-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

test("a Tool in the EU that is switched on carries no warning, on its Outils page nor in the Audit", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, SUPER_ADMIN);
  // Mistral AI is configured (on) and in the EU.
  await page.goto("/admin/outils/mistral");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mistral AI");
  await expect(page.getByRole("definition").filter({ hasText: fr.admin.tools.residencies.eu })).toBeVisible();
  await expect(page.locator("[data-uncovered-recipient]")).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: tr(uncovered.title, "Mistral AI") })).toHaveCount(0);
  await page.goto("/admin/parametres?tab=ia&fournisseur=mistral");
  await expect(page.getByRole("alert").filter({ hasText: uncovered.warning })).toHaveCount(0);
  await page.goto("/admin/activite/actions?section=recipients_outside_eu");
  await expect(page.getByRole("row").filter({ hasText: "Mistral" })).toHaveCount(0);
  await context.close();
});

test.describe("the build (npm run build -w @jobhub/help)", () => {
  test.describe.configure({ mode: "serial" });
  const dir = path.resolve("packages/help/legal/confidentialite");
  const written: string[] = [];
  const policy = (lang: "fr" | "en", ids: string) =>
    `---\ntitle: ${lang === "fr" ? "Politique de confidentialité" : "Privacy policy"}\neffective: 2099-01-01\nchange: substantielle\napproved_by: Test\nsummary: ${lang === "fr" ? "Test." : "Test."}\nrecipients_outside_eu: ${ids}\n---\n## ${lang === "fr" ? "Responsable" : "Controller"}\nFN Consult.\n\n## Cookies {#cookies}\nAucun.\n\n## IA {#ia}\nVoies.\n`;

  test.afterEach(() => {
    for (const file of written.splice(0)) rmSync(file, { force: true });
  });

  test("refuses a recipients_outside_eu naming a Tool the catalog does not have", () => {
    mkdirSync(dir, { recursive: true });
    for (const lang of ["fr", "en"] as const) {
      const file = path.join(dir, `2099-01-01.${lang}.md`);
      written.push(file);
      writeFileSync(file, policy(lang, "[anthropic, not-a-tool]"));
    }
    // The build rewrites the articles' and release notes' modules before it reads the legal texts: same content, newer
    // mtime, which the web server's freshness check would take for a stale app build. Put the mtimes back.
    const generated = ["articles", "release-notes"].map((name) => path.resolve(`packages/help/src/${name}.generated.ts`));
    const times = generated.map((file) => statSync(file));
    const build = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });
    generated.forEach((file, i) => utimesSync(file, times[i]!.atime, times[i]!.mtime));
    const output = `${build.stdout}${build.stderr}`;
    expect(build.status, output).not.toBe(0);
    expect(output).toContain("recipients_outside_eu names not-a-tool, which is no Tool of the catalog");
    expect(existsSync(path.join(dir, "2099-01-01.fr.md"))).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });
});

function tr(template: string, name: string) {
  return template.replace(/\{\{name\}\}/g, name);
}
