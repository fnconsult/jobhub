import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId as idOf } from "./support/extension";
import { newAddress } from "./support/mailbox";

const extensionDir = path.resolve("apps/extension/.output/chrome-mv3");
const frCatalogue = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

const unpackedExtensionId = (dir: string) => idOf(realpathSync(dir));

test.describe("browser extension", () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.skip(!existsSync(extensionDir), "Build the extension first: npm run build -w @jobhub/extension");
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "en-US",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("is a Chrome MV3 extension whose default locale is French", () => {
    const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.default_locale).toBe("fr");
    expect(manifest.name).toBe("__MSG_extName__");
    const fr = JSON.parse(readFileSync(path.join(extensionDir, "_locales/fr/messages.json"), "utf8"));
    expect(fr.extName.message).toBe("Jobbbox");
    expect(fr.extDescription.message).toMatch(/offre d'emploi/);
  });

  test("loads in Chrome and its popup speaks French from the shared catalogue", async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionDir)}/popup.html`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle("Jobbbox");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jobbbox");
    await expect(page.getByText("Capturez une offre d'emploi depuis la page que vous consultez.")).toBeVisible();

    const allowed = new Set(catalogueStrings(frCatalogue));
    const texts = await renderedTexts(page);
    expect(texts.map((t) => t.text).filter((text) => !allowed.has(text))).toEqual([]);
  });

  test("popup uses the shared design tokens and meets the ADR-0009 floor", async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionDir)}/popup.html`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }

    // The shared stylesheet honours the text-size setting here too.
    await page.evaluate(() => (document.documentElement.dataset.textSize = "xlarge"));
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  });
});

// Issue #2: the extension shares the Candidate's web-app session (needed by
// Guest conversion). Built against the e2e web server, whose EXTENSION_ORIGINS
// trusts exactly this build (see playwright.config.ts).
test.describe("browser extension shares the web app session", () => {
  const origin = process.env.E2E_WEB_ORIGIN!;
  const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    execFileSync("npx", ["wxt", "build", "--mode", "e2e"], {
      cwd: "apps/extension",
      env: { ...process.env, WXT_WEB_ORIGIN: origin },
      stdio: "pipe",
    });
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "en-US",
      baseURL: origin,
      args: [`--disable-extensions-except=${e2eExtensionDir}`, `--load-extension=${e2eExtensionDir}`],
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  async function openPopup(): Promise<Page> {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${unpackedExtensionId(e2eExtensionDir)}/popup.html`);
    await expect(popup.getByRole("heading", { level: 1 })).toBeVisible();
    return popup;
  }

  test("is signed out, and points to the web sign-in page, while nobody is signed in", async () => {
    const popup = await openPopup();
    await expect(popup.getByText(frCatalogue.extension.signedOut)).toBeVisible();
    await expect(popup.getByRole("link", { name: frCatalogue.extension.signIn })).toHaveAttribute(
      "href",
      `${origin}/connexion`,
    );
  });

  test("knows the Candidate signed in on the web app, speaks their language, and may act for them", async () => {
    const email = newAddress("extension");
    const web = await context.newPage();
    await signInWithMagicLink(web, email);

    let popup = await openPopup();
    await expect(popup.getByText(frCatalogue.extension.signedInAs.replace("{{email}}", email))).toBeVisible();
    await expect(popup.getByRole("link", { name: frCatalogue.extension.account })).toHaveAttribute(
      "href",
      `${origin}/compte`,
    );

    await web.getByLabel(frCatalogue.account.interfaceLanguage).selectOption("en");
    await expect(web.locator("html")).toHaveAttribute("lang", "en");
    popup = await openPopup();
    await expect(popup.locator("html")).toHaveAttribute("lang", "en");
    await expect(popup.getByText(en.extension.signedInAs.replace("{{email}}", email))).toBeVisible();
    await expect(popup.getByRole("link", { name: en.extension.account })).toBeVisible();

    // The extension is a trusted origin: it may act for the Candidate (here, sign out).
    const status = await popup.evaluate(async (webOrigin) => {
      const response = await fetch(`${webOrigin}/api/auth/sign-out`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return response.status;
    }, origin);
    expect(status).toBe(200);
    await web.goto("/compte");
    await expect(web).toHaveURL(/\/connexion$/);
    popup = await openPopup();
    await expect(popup.getByText(frCatalogue.extension.signedOut)).toBeVisible();
  });
});
