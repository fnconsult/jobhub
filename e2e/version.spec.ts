import { readFileSync } from "node:fs";
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
  test("/api/health answers with the Version, the commit and the environment", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version, commit: null, environment: "e2e" });
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
