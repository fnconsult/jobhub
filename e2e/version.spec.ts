import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API_VERSION } from "@jobhub/shared";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #559 (ADR-0063): one Version, X.Y.Z, from the root package.json. The e2e suite runs what `main` carries, as the
// Beta does: « X.Y.Z (main·sha) », its commit « dev » here, where no image carries one. Production's « X.Y.Z » alone is
// apps/web/src/release/release.test.ts's.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const shown = `${version} (main·dev)`;
const line = fr.release.line.replace("{{version}}", shown);
const origin = process.env.E2E_WEB_ORIGIN!;
// A permanent super-admin of its own (ADMIN_EMAILS, playwright.config.ts).
const ADMINISTRATOR = "version-office@e2e.jobbbox.test";

test.describe("the Version served (#559)", () => {
  test("/api/health answers with the Version, the commit, the environment and the API Version (#564)", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version, commit: null, environment: "e2e", apiVersion: API_VERSION });
  });

  test("Mon compte shows « Version de Jobbbox » under its Sections", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const page = await context.newPage();
    await signInWithMagicLink(page, newAddress("version"));
    await page.goto("/compte/preferences");
    await expect(page.locator("#main").getByText(line, { exact: true })).toBeVisible();
    await context.close();
  });

  test("the Back Office's sidebar foot names the Version", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const page = await context.newPage();
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin");
    await expect(page.locator(".sidebar-foot").getByText(line, { exact: true })).toBeVisible();
    await context.close();
  });
});

// Issue #920: Outils shows an Administrator the latest extension to load unpacked, before the store review: the zip of
// the environment served (the e2e suite runs what `main` carries, as the Beta: the beta zip). Issue #989: the server
// serves it itself, from EXTENSION_ZIP_DIR (an image's, apps/web/Dockerfile; here playwright.config.ts's), not GitHub.
test.describe("« Dernière version de l'extension » in Outils (#920, #989)", () => {
  test.describe.configure({ mode: "serial" });
  const extensionVersion = (JSON.parse(readFileSync("apps/extension/package.json", "utf8")) as { version: string }).version;
  const texts = fr.account.tools.testBuild;
  const zip = `jobbbox-extension-${extensionVersion}-chrome-beta.zip`;
  const zipFile = path.join(process.env.E2E_EXTENSION_ZIP_DIR!, zip);
  const bytes = Buffer.from("PK\u0005\u0006 e2e extension zip");

  test.afterAll(() => rmSync(zipFile, { force: true }));

  test("an Administrator downloads the Beta's zip from the server, with no GitHub link", async ({ browser }) => {
    mkdirSync(path.dirname(zipFile), { recursive: true });
    writeFileSync(zipFile, bytes);
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const page = await context.newPage();
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/compte/outils");
    const block = page.getByRole("region", { name: texts.title });
    await expect(block).toBeVisible();
    await expect(block.getByRole("definition").first()).toHaveText(extensionVersion);
    await expect(block.getByRole("definition").nth(1)).toHaveText(String(API_VERSION));
    await expect(block.getByRole("listitem").first()).toHaveText(texts.steps.download.replace("{{zip}}", zip));
    await expect(block.getByRole("listitem").nth(1)).toHaveText(texts.steps.developerMode);
    await expect(block.getByRole("listitem").nth(2)).toHaveText(texts.steps.loadUnpacked);
    await expect(block.locator('a[href*="github.com"]')).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      block.getByRole("link", { name: texts.download.replace("{{zip}}", zip) }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(zip);
    expect(readFileSync((await download.path())!)).toEqual(bytes);
    await context.close();
  });

  test("with no zip on the server, Outils says so and the route answers 404", async ({ browser }) => {
    rmSync(zipFile, { force: true });
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const page = await context.newPage();
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/compte/outils");
    const block = page.getByRole("region", { name: texts.title });
    await expect(block.getByText(texts.unavailable.replace("{{zip}}", zip))).toBeVisible();
    await expect(block.getByRole("link", { name: texts.download.replace("{{zip}}", zip) })).toHaveCount(0);
    expect((await page.request.get("/api/account/extension-test-build")).status()).toBe(404);
    await context.close();
  });

  test("a Candidate who is not an Administrator does not see it", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const page = await context.newPage();
    await signInWithMagicLink(page, newAddress("tools-candidate"));
    await page.goto("/compte/outils");
    await expect(page.getByRole("region", { name: fr.account.tools.extensionTitle })).toBeVisible();
    await expect(page.getByRole("region", { name: texts.title })).toHaveCount(0);
    // The zip stays out of reach of anyone Outils does not show it to.
    mkdirSync(path.dirname(zipFile), { recursive: true });
    writeFileSync(zipFile, bytes);
    expect((await page.request.get("/api/account/extension-test-build")).status()).toBe(404);
    await context.close();
  });
});
