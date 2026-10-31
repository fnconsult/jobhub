import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { startServer, type PlanPricesServer } from "./support/plan-prices";

// Issue #547 (ADR-0062): after the effective date of a substantial version of the privacy policy, a signed-in
// Candidate is shown once « Notre politique de confidentialité a changé le <date> », with its link and « J'ai compris »,
// no box and nothing blocked; closed, it never comes back for them.
//
// In the root-env project, which runs one spec at a time: it writes a fixture version of the privacy policy into
// packages/help/legal/confidentialite/, rebuilds @jobhub/help and serves it with `next dev` (a second server on the
// suite's database, the Candidate's session carrying over), then restores both. No fixture is ever committed.
test.use({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "fr-FR" });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const policyDir = path.resolve("packages/help/legal/confidentialite");
const generated = path.resolve("packages/help/src/legal-texts.generated.ts");
const EFFECTIVE = "2026-01-01"; // in effect: the Candidate below signed up before it

const version = (locale: "fr" | "en") =>
  [
    "---",
    `title: ${locale === "fr" ? "Politique de confidentialité" : "Privacy policy"}`,
    `effective: ${EFFECTIVE}`,
    "change: substantielle",
    "approved_by: Camille Martin",
    `summary: ${locale === "fr" ? "Un nouveau destinataire hors UE." : "A new recipient outside the EU."}`,
    "---",
    locale === "fr" ? "## Qui traite vos données\nFN Consult.\n\n## Cookies {#cookies}\nAucun traceur.\n\n## IA dans Jobbbox {#ia}\nLes voies de l'IA.\n" : "## Who processes your data\nFN Consult.\n\n## Cookies {#cookies}\nNo tracker.\n\n## AI in Jobbbox {#ia}\nThe AI routes.\n",
  ].join("\n");

const clear = () => {
  rmSync(policyDir, { recursive: true, force: true });
  mkdirSync(policyDir, { recursive: true });
  writeFileSync(path.join(policyDir, ".gitkeep"), "");
};

test.describe("The privacy policy's change, shown once (#547)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  let savedGenerated = "";
  let server: PlanPricesServer;
  const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

  test.beforeAll(async () => {
    savedGenerated = readFileSync(generated, "utf8");
    clear();
    for (const locale of ["fr", "en"] as const) writeFileSync(path.join(policyDir, `${EFFECTIVE}.${locale}.md`), version(locale));
    const built = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });
    expect(built.status, built.stdout + built.stderr).toBe(0);
    server = await startServer(547, {}, "dev");
  });
  test.afterAll(async () => {
    server?.stop();
    clear();
    writeFileSync(generated, savedGenerated);
    await db.end();
  });

  test("a Candidate who signed up before it sees it once, closes it with « J'ai compris », and never sees it again", async ({ page }) => {
    const email = newAddress("privacy-change");
    await signInWithMagicLink(page, email);
    await db.query(`UPDATE candidate SET "createdAt" = '2025-06-01T10:00:00Z' WHERE email = $1`, [email]);

    await page.goto(`${server.origin}/candidatures`, { timeout: 120_000 });
    const notice = page.getByRole("region", { name: fr.privacyChange.label });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText(fr.privacyChange.message.replace("{{date}}", "1 janvier 2026"));
    await expect(notice.getByRole("link", { name: fr.privacyChange.read })).toHaveAttribute("href", `/legal/confidentialite/${EFFECTIVE}`);
    await expect(notice.getByRole("checkbox")).toHaveCount(0);
    // Nothing is blocked: the page is there beside it.
    await expect(page.getByRole("main")).toBeVisible();

    const closed = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/privacy-change/${EFFECTIVE}`);
    await notice.getByRole("button", { name: fr.privacyChange.dismiss }).click();
    expect((await closed).status()).toBe(204);
    await expect(notice).toHaveCount(0);

    await page.reload({ timeout: 120_000 });
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: fr.privacyChange.label })).toHaveCount(0);
    await page.goto(`${server.origin}/agenda`, { timeout: 120_000 });
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: fr.privacyChange.label })).toHaveCount(0);
  });

  test("a Candidate who signed up under it is not shown it", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("privacy-change-new"));

    await page.goto(`${server.origin}/candidatures`, { timeout: 120_000 });
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: fr.privacyChange.label })).toHaveCount(0);
  });
});
