import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId as idOf } from "./support/extension";
import { newAddress } from "./support/mailbox";

const extensionDir = path.resolve("apps/extension/.output/chrome-mv3");
const frCatalogue = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

const unpackedExtensionId = (dir: string) => idOf(realpathSync(dir));

let e2eBuilt = false;
/** Builds the extension against the e2e web server, whose EXTENSION_ORIGINS trusts exactly this build. */
function buildE2eExtension() {
  if (e2eBuilt) return;
  execFileSync("npx", ["wxt", "build", "--mode", "e2e"], {
    cwd: "apps/extension",
    env: { ...process.env, WXT_WEB_ORIGIN: process.env.E2E_WEB_ORIGIN! },
    stdio: "pipe",
  });
  e2eBuilt = true;
}

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
    buildE2eExtension();
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

// Issue #10: a Guest captures a job page in their own browser and gets a Match Score.
test.describe("Guest Capture and Match Score", () => {
  const origin = process.env.E2E_WEB_ORIGIN!;
  const fr = frCatalogue.extension;
  const posting = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: "Directeur administratif et financier H/F",
    description: "<p>Rattaché au DG, vous pilotez la finance du groupe.</p><p>15 ans d'expérience minimum.</p>",
    datePosted: "2026-09-30",
    hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Lyon" } },
    skills: "IFRS, Consolidation, Power BI",
  };
  const jobPageHtml = (jsonLd: object | null) => `<!doctype html><html lang="fr"><head><title>DAF H/F – Groupe Seb</title>
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}</head>
    <body><main><h1>Directeur administratif et financier H/F</h1><p>Rattaché au DG, vous pilotez la finance du groupe.</p></main></body></html>`;
  const postingUrl = "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon";
  const articleUrl = "https://www.welcometothejungle.com/fr/articles/bien-negocier-son-salaire";
  const cvFile = { name: "CV Marie Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) };
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    buildE2eExtension();
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "fr-FR",
      args: [`--disable-extensions-except=${e2eExtensionDir}`, `--load-extension=${e2eExtensionDir}`],
    });
    // The job board, served locally: the page is read in this browser, never fetched by Jobbbox (ADR-0002).
    await context.route(postingUrl, (route) => route.fulfill({ contentType: "text/html", body: jobPageHtml(posting) }));
    await context.route(articleUrl, (route) => route.fulfill({ contentType: "text/html", body: jobPageHtml(null) }));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  const extensionId = () => unpackedExtensionId(e2eExtensionDir);
  type SessionStorage = { get(key: string): Promise<Record<string, { cv: { fullName: string }; jobOffer: { id: string }; expiresAt: number }>> };
  const guestSession = (page: Page) =>
    page.evaluate(() => (globalThis as unknown as { chrome: { storage: { session: SessionStorage } } }).chrome.storage.session.get("guestSession"));
  /** Whether a text comes from the catalogue, its {{placeholders}} filled. */
  const fromCatalogue = (text: string) =>
    catalogueStrings(frCatalogue).some((entry) =>
      new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{\\\{\w+\\\}\\\}/g, ".+")}$`).test(text),
    );

  test("is one MV3 build for Chrome and Edge, asking only for what Capture needs", () => {
    const manifest = JSON.parse(readFileSync(path.join(e2eExtensionDir, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    // Edge rejects store-specific keys and "Chrome" in the name or description.
    expect(manifest).not.toHaveProperty("update_url");
    const messages = readFileSync(path.join(e2eExtensionDir, "_locales/fr/messages.json"), "utf8");
    expect(messages).not.toMatch(/chrome/i);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "alarms", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual([`${origin}/*`]);
    expect(manifest.content_scripts[0].matches).toContain("https://www.welcometothejungle.com/*");
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });

  test("shows the badge on a job posting, captures it, and scores the Guest's CV, keeping it in the browser only", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const badge = jobPage.getByRole("button", { name: fr.badgeLabel });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(fr.badge);

    const [analysis] = await Promise.all([context.waitForEvent("page"), badge.click()]);
    await expect(analysis).toHaveURL(`chrome-extension://${extensionId()}/analyse.html`);
    await expect(analysis.getByRole("heading", { level: 1 })).toHaveText(fr.analysis.title);
    await expect(analysis.getByText("Directeur administratif et financier H/F")).toBeVisible();
    await expect(analysis.getByText(fr.analysis.guestNotice)).toBeVisible();

    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();
    await expect(analysis.getByText(fr.analysis.covered.replace("{{skills}}", "IFRS, Consolidation"))).toBeVisible();
    await expect(analysis.getByText(fr.analysis.missing.replace("{{skills}}", "Power BI"))).toBeVisible();

    // ADR-0009 floor, and every text from the catalogue but the Job Offer's own.
    const texts = await renderedTexts(analysis);
    expect(texts.map((t) => t.text).filter((text) => !fromCatalogue(text) && !/Directeur|Groupe Seb|^Lyon$/.test(text))).toEqual([]);
    for (const t of texts) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }

    // The Guest session lives in the browser's session storage, for 23 hours at most (ADR-0003).
    const { guestSession: stored } = await guestSession(analysis);
    expect(stored.cv.fullName).toBe("Marie Dupont");
    expect(stored.expiresAt - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect(stored.expiresAt - Date.now()).toBeGreaterThan(22 * 3_600_000);
    // The Job Offer is stored once, for everyone, and found by its id.
    expect((await analysis.request.get(`${origin}/api/job-offers/${stored.jobOffer.id}`)).status()).toBe(200);

    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    expect(await guestSession(analysis)).toEqual({});
  });

  test("shows no badge on a page that is not a job posting, where Capture is still possible by hand", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(articleUrl);
    await expect(jobPage.locator("h1")).toBeVisible();
    await jobPage.waitForTimeout(2500);
    await expect(jobPage.getByRole("button", { name: fr.badgeLabel })).toHaveCount(0);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId()}/popup.html`);
    await jobPage.bringToFront();
    const [analysis] = await Promise.all([
      context.waitForEvent("page"),
      popup.getByRole("button", { name: fr.capturePage }).click(),
    ]);
    await expect(analysis.getByText("Directeur administratif et financier H/F", { exact: true })).toBeVisible();
    await expect(analysis.getByLabel(frCatalogue.cvUpload.fileLabel)).toBeVisible();
  });

});
