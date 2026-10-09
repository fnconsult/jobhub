import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId as idOf } from "./support/extension";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

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
    baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 90000, maxValue: 110000, unitText: "YEAR" } },
  };
  const jobPageHtml = (jsonLd: object | null, heading = "Directeur administratif et financier H/F") => `<!doctype html><html lang="fr"><head><title>${heading} – Groupe Seb</title>
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}</head>
    <body><main><h1>${heading}</h1><p>Rattaché au DG, vous pilotez la finance du groupe.</p></main></body></html>`;
  // Postings on other major job boards and career sites (ATS), recognised by their address alone (no JSON-LD).
  const boardPages: Record<string, string> = {
    "https://www.linkedin.com/jobs/view/4012345678/": "LinkedIn",
    "https://fr.indeed.com/viewjob?jk=8f2c1a9b7e6d5c4b": "Indeed",
    "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W": "Apec",
    "https://candidat.francetravail.fr/offres/recherche/detail/190ABCD": "France Travail",
    "https://jobs.lever.co/doctolib/3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b": "Lever",
    "https://boards.greenhouse.io/alan/jobs/4567890": "Greenhouse",
    "https://seb.teamtailor.com/jobs/3456789-controleur-de-gestion": "Teamtailor",
    "https://groupeseb.wd3.myworkdayjobs.com/fr-FR/careers/job/Lyon/DAF_R-12345": "Workday",
  };
  const boardPageHtml = `<!doctype html><html lang="fr"><head><title>Contrôleur de gestion H/F</title></head>
    <body><main><h1>Contrôleur de gestion H/F</h1><p>Vous rejoignez la direction financière à Lyon.</p></main></body></html>`;
  const careerPosting = {
    ...posting,
    title: "Responsable consolidation H/F",
    description: "<p>Vous pilotez la consolidation IFRS du groupe, à Lyon.</p>",
    hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
  };
  const careerSitePort = Number(process.env.E2E_WEB_PORT) + 100;
  const careerSiteUrl = `http://127.0.0.1:${careerSitePort}/carrieres/responsable-consolidation-lyon`;
  // Not a posting address Jobbbox knows: the page is detected by its schema.org JobPosting.
  const careerPageUrl = "https://groupeseb.teamtailor.com/fr/carrieres/responsable-consolidation-lyon";
  const careerSiteVisits: IncomingMessage[] = [];
  let careerSite: Server;
  const postingUrl = "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon";
  // A posting's address whose page has nothing to read yet (a single-page app still loading).
  const emptyPostingUrl = "https://www.welcometothejungle.com/fr/companies/seb/jobs/empty";
  const articleUrl = "https://www.welcometothejungle.com/fr/articles/bien-negocier-son-salaire";
  const cvFile = { name: "CV Marie Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) };
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    buildE2eExtension();
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "fr-FR",
      baseURL: origin,
      args: [`--disable-extensions-except=${e2eExtensionDir}`, `--load-extension=${e2eExtensionDir}`],
    });
    // The job board, served locally: the page is read in this browser, never fetched by Jobbbox (ADR-0002).
    await context.route(postingUrl, (route) => route.fulfill({ contentType: "text/html", body: jobPageHtml(posting) }));
    await context.route(articleUrl, (route) => route.fulfill({ contentType: "text/html", body: jobPageHtml(null) }));
    await context.route(emptyPostingUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head></head><body></body></html>" }));
    for (const url of Object.keys(boardPages)) {
      await context.route(url, (route) => route.fulfill({ contentType: "text/html", body: boardPageHtml }));
    }
    // An employer's career site: a real HTTP server, which notes who reads it, behind the site's public address.
    careerSite = createServer((request, response) => {
      careerSiteVisits.push(request);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(jobPageHtml(careerPosting, careerPosting.title));
    });
    await new Promise<void>((resolve) => careerSite.listen(careerSitePort, "127.0.0.1", resolve));
    await context.route(careerPageUrl, async (route) => route.fulfill({ response: await route.fetch({ url: careerSiteUrl }) }));
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => careerSite?.close(resolve));
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
    // Every other site only if the person opts in, from the popup; the badge's script is then registered from the build.
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
    expect(manifest.content_scripts[0].js).toEqual(["content-scripts/job-page.js"]);
  });

  test("offers, unticked, to detect postings on every site, an employer's own career site included", async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId()}/popup.html`);
    const option = popup.getByRole("checkbox", { name: fr.allSites });
    await expect(option).not.toBeChecked();
    await expect(option).toHaveAccessibleDescription(fr.allSitesHint);
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
    // The offer states its salary: the Guest, who gave no minimum, is told so, not that the offer is silent.
    const salary = analysis.getByRole("listitem").filter({ hasText: fr.analysis.criteria.salary });
    await expect(salary).toContainText(fr.analysis.status.noPreference);
    await expect(salary).toContainText(/L'offre : 90\s000\s€ – 110\s000\s€ brut par an/);

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

    // Reopening the page shows the same Match Score without computing it again (#51); a rescore computes it anew.
    const scoreRequests: string[] = [];
    analysis.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/match-score") scoreRequests.push(request.url());
    });
    const shown = await analysis.getByText(/^Match Score : \d+ \/ 100$/).textContent();
    await analysis.reload();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toHaveText(shown!);
    expect(scoreRequests).toEqual([]);
    await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
    await expect.poll(() => scoreRequests.length).toBe(1);
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();

    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    expect(await guestSession(analysis)).toEqual({});
  });

  // Issue #51: a Match Score uses the Candidate's Plan Quota, so the extension scores once per Job Offer and CV.
  const scoreLine = /^Match Score : \d+ \/ 100$/;
  /** Every request any page of the context makes to /api/match-score, from now on, and what each sent. */
  const countScoreRequests = () => {
    const requests: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const listener = (request: { url(): string; postData(): string | null }) => {
      if (new URL(request.url()).pathname !== "/api/match-score") return;
      requests.push(request.url());
      bodies.push(JSON.parse(request.postData() ?? "{}"));
    };
    context.on("request", listener);
    return { requests, bodies, stop: () => context.off("request", listener) };
  };
  const reopenAnalysis = async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId()}/analyse.html`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.analysis.title);
    return page;
  };
  const captureFromBadge = async (url: string) => {
    const jobPage = await context.newPage();
    await jobPage.goto(url);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);
    await expect(analysis.getByRole("heading", { level: 1 })).toHaveText(fr.analysis.title);
    return analysis;
  };
  const otherCvFile = {
    name: "CV Marie Dupont 2026.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV.map((line) => (line.startsWith("Consolidation,") ? "Consolidation, IFRS, Power BI, SAP" : line)))),
  };

  test("a Guest's Match Score is kept for its Job Offer and CV: reopened without scoring again, scored anew for another CV or Job Offer (#51)", async () => {
    const analysis = await captureFromBadge(postingUrl);
    const scores = countScoreRequests();
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    await expect(analysis.getByText(fr.analysis.missing.replace("{{skills}}", "Power BI"))).toBeVisible();
    await expect.poll(() => scores.requests.length).toBe(1);
    const shown = await analysis.getByText(scoreLine).textContent();
    // The Guest's CV goes with the Search Criteria read from it (#75), as kept in the Guest session.
    const { guestSession: kept } = await guestSession(analysis);
    expect(scores.bodies[0]).toEqual({ jobOfferId: kept.jobOffer.id, cv: kept.cv, searchCriteria: kept.searchCriteria });
    expect(scores.bodies[0]).not.toHaveProperty("profileId");

    // Reloading, or opening the analysis page again, shows the same Match Score without asking for one.
    await analysis.reload();
    await expect(analysis.getByText(scoreLine)).toHaveText(shown!);
    const reopened = await reopenAnalysis();
    await expect(reopened.getByText(scoreLine)).toHaveText(shown!);
    await expect(reopened.getByText(fr.analysis.missing.replace("{{skills}}", "Power BI"))).toBeVisible();
    await reopened.close();
    expect(scores.requests).toHaveLength(1);

    // Another CV is scored anew, and that score is the one kept.
    await analysis.getByRole("button", { name: fr.analysis.changeCv }).click();
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(otherCvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(fr.analysis.covered.replace("{{skills}}", "IFRS, Consolidation, Power BI"))).toBeVisible();
    await expect.poll(() => scores.requests.length).toBe(2);
    await analysis.reload();
    await expect(analysis.getByText(fr.analysis.covered.replace("{{skills}}", "IFRS, Consolidation, Power BI"))).toBeVisible();
    expect(scores.requests).toHaveLength(2);

    // Another Job Offer captured is scored anew with the kept CV, then kept in turn.
    const other = await captureFromBadge(Object.keys(boardPages)[4]!);
    await expect(other.getByText(/^Contr.+leur de gestion H\/F$/)).toBeVisible();
    await expect(other.getByText(scoreLine)).toBeVisible();
    await expect.poll(() => scores.requests.length).toBe(3);
    await other.reload();
    await expect(other.getByText(scoreLine)).toBeVisible();
    await expect(other.getByText(/^Contr.+leur de gestion H\/F$/)).toBeVisible();
    expect(scores.requests).toHaveLength(3);

    // "Recalculer le Match Score" asks for one, whatever is kept.
    await other.getByRole("button", { name: fr.analysis.rescore }).click();
    await expect.poll(() => scores.requests.length).toBe(4);
    await expect(other.getByText(scoreLine)).toBeVisible();
    scores.stop();
    await other.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(other.getByText(fr.analysis.forgotten)).toBeVisible();
  });

  test("the kept Match Score is forgotten with the rest of the Guest session, by \"Oublier\" or at its end (#51)", async () => {
    const scores = countScoreRequests();
    // "Oublier": reopening the page shows no Match Score, and asks for none.
    let analysis = await captureFromBadge(postingUrl);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    expect((await guestSession(analysis)).guestSession).toHaveProperty("matchScore");
    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    expect(await guestSession(analysis)).toEqual({});
    let reopened = await reopenAnalysis();
    await expect(reopened.getByText(fr.analysis.noJobOffer)).toBeVisible();
    await expect(reopened.getByText(scoreLine)).toHaveCount(0);
    await reopened.close();
    await expect.poll(() => scores.requests.length).toBe(1);

    // The session's end (24 hours at most, ADR-0003) takes the kept Match Score with it.
    analysis = await captureFromBadge(postingUrl);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    await expect.poll(() => scores.requests.length).toBe(2);
    await analysis.evaluate(async () => {
      type Storage = { get(key: string): Promise<Record<string, object>>; set(items: object): Promise<void> };
      const storage = (globalThis as unknown as { chrome: { storage: { session: Storage } } }).chrome.storage.session;
      const { guestSession } = await storage.get("guestSession");
      await storage.set({ guestSession: { ...guestSession, expiresAt: Date.now() - 1_000 } });
    });
    reopened = await reopenAnalysis();
    await expect(reopened.getByText(fr.analysis.noJobOffer)).toBeVisible();
    await expect(reopened.getByText(scoreLine)).toHaveCount(0);
    expect(await guestSession(reopened)).toEqual({});
    expect(scores.requests).toHaveLength(2);
    scores.stop();
  });

  test("a slow rescore uses one Match Score however often it is clicked, and \"Oublier\" meanwhile keeps nothing once it returns (#51)", async () => {
    const analysis = await captureFromBadge(postingUrl);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    // /api/match-score answers 1.5 s late; `answered` counts the answers that reached the page.
    let answered = 0;
    await context.route("**/api/match-score", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
      answered += 1;
    });
    const scores = countScoreRequests();
    try {
      // A double-click on "Recalculer le Match Score" asks for one Match Score, not two.
      await analysis.getByRole("button", { name: fr.analysis.rescore }).dblclick();
      await expect(analysis.getByText(scoreLine)).toBeVisible();
      await expect.poll(() => answered).toBeGreaterThanOrEqual(1);
      await analysis.waitForTimeout(2_000);
      expect(scores.requests).toHaveLength(1);

      // "Oublier" while a Match Score is computed: once it comes back, the session stays forgotten (ADR-0003).
      await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
      await expect(analysis.getByText(fr.analysis.scoring)).toBeVisible();
      await analysis.getByRole("button", { name: fr.analysis.forget }).click();
      await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
      await expect.poll(() => answered).toBe(2);
      await analysis.waitForTimeout(500);
      expect(await guestSession(analysis)).toEqual({});
      await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
      await expect(analysis.getByText(scoreLine)).toHaveCount(0);
    } finally {
      scores.stop();
      await context.unroute("**/api/match-score");
    }
  });

  test("a signed-in Free Candidate's new Job Offer is scored against their Profile, no CV asked; reopening uses no Match Score; past their Plan Quota, the Upgrade Prompt (#51, #75)", async () => {
    test.slow();
    const web = await context.newPage();
    await signInWithMagicLink(web, newAddress("extension-score-quota"));
    const masterCv = {
      fullName: "Marie Dupont", headline: "Directrice financière", email: "", phone: "", location: "Lyon", summary: "",
      experience: [], education: [], skills: ["IFRS"], languages: [],
    };
    const created = await web.request.post(`${origin}/api/profiles`, { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } } });
    expect(created.status(), await created.text()).toBe(201);
    const profileId = (await created.json()).id as string;
    const used = async () => {
      await web.goto("/abonnement");
      return web.locator("dl div").filter({ hasText: "Match Scores" }).locator("dd").textContent();
    };

    // A new Job Offer is scored against their Profile at once: no CV is asked for.
    const scores = countScoreRequests();
    const analysis = await captureFromBadge(postingUrl);
    await expect(analysis.getByText(fr.analysis.candidateNotice)).toBeVisible();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    await expect(analysis.getByLabel(fr.analysis.scoreProfileLabel)).toHaveValue(profileId);
    await expect(analysis.getByLabel(frCatalogue.cvUpload.fileLabel)).toHaveCount(0);
    expect(scores.bodies).toEqual([{ jobOfferId: expect.any(String), profileId }]);
    const shown = await analysis.getByText(scoreLine).textContent();
    expect(await used()).toBe("1 sur 3");

    // Reopening and reloading the page, again and again, shows the kept Match Score and uses none of the Plan Quota.
    for (let i = 0; i < 3; i++) {
      await analysis.reload();
      await expect(analysis.getByText(scoreLine)).toHaveText(shown!);
    }
    const reopened = await reopenAnalysis();
    await expect(reopened.getByText(scoreLine)).toHaveText(shown!);
    await reopened.close();
    expect(scores.requests).toHaveLength(1);
    expect(await used()).toBe("1 sur 3");

    // Asking for new Match Scores uses the Plan Quota, up to its limit; then the Upgrade Prompt (QA case 11.3).
    for (let i = 0; i < 2; i++) {
      await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
      await expect.poll(() => scores.requests.length).toBe(2 + i);
      await expect(analysis.getByText(scoreLine)).toBeVisible();
    }
    expect(await used()).toBe("3 sur 3");
    await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
    const prompt = analysis.getByRole("alert").filter({ hasText: "Vous avez utilisé les 3 Match Scores compris ce mois-ci" });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute("href", `${origin}/abonnement`);
    expect(scores.requests).toHaveLength(4);

    // The kept Match Score is still shown on reopen, past the quota, without asking for one.
    await analysis.reload();
    await expect(analysis.getByText(scoreLine)).toBeVisible();
    expect(scores.requests).toHaveLength(4);
    scores.stop();

    // Another CV can still be scored instead, and the Profile chosen again.
    await analysis.getByRole("button", { name: fr.analysis.changeCv }).click();
    await expect(analysis.getByLabel(frCatalogue.cvUpload.fileLabel)).toBeVisible();
    await analysis.getByRole("button", { name: fr.analysis.useProfile }).click();
    await expect(analysis.getByText(scoreLine)).toHaveText(shown!);
    await analysis.getByRole("button", { name: fr.analysis.forgetCv }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
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

  test("says so when the badge is clicked on a posting's address with nothing to capture", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(emptyPostingUrl);
    const pages = context.pages().length;
    await jobPage.getByRole("button", { name: fr.badgeLabel }).click();
    await expect(jobPage.getByRole("status")).toHaveText(fr.captureImpossible);
    expect(context.pages()).toHaveLength(pages);
  });

  test("shows only the latest CV error, however many files were refused", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);
    const file = analysis.getByLabel(frCatalogue.cvUpload.fileLabel);
    const submit = analysis.getByRole("button", { name: fr.analysis.submit });

    const refuse = async (name: string, mimeType: string) => {
      await file.setInputFiles({ name, mimeType, buffer: Buffer.from("Mes notes") });
      await Promise.all([analysis.waitForResponse(`${origin}/api/cv/draft`), submit.click()]);
      await expect(analysis.getByRole("alert")).toHaveText(frCatalogue.cvUpload.errors.unsupported_format);
    };
    await refuse("notes.txt", "text/plain");
    await refuse("notes.doc", "application/msword");
    await expect(analysis.getByRole("alert")).toHaveCount(1);

    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
  });

  test("shows the badge on postings of the other major job boards and career sites, known by their address", async () => {
    for (const [url, site] of Object.entries(boardPages)) {
      const boardPage = await context.newPage();
      await boardPage.goto(url);
      await expect(boardPage.getByRole("button", { name: fr.badgeLabel }), site).toBeVisible();
      await boardPage.close();
    }
  });

  test("detects a posting on an employer's career site by its JobPosting, read in this browser and never fetched by Jobbbox", async () => {
    const careerPage = await context.newPage();
    await careerPage.goto(careerPageUrl);
    const [analysis] = await Promise.all([
      context.waitForEvent("page"),
      careerPage.getByRole("button", { name: fr.badgeLabel }).click(),
    ]);
    await expect(analysis.getByText(careerPosting.title, { exact: true })).toBeVisible();
    await expect(analysis.getByText("— Groupe Seb · Lyon")).toBeVisible();
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();

    // Jobbbox does not scrape (ADR-0002): told only where a posting is, it fetches nothing and captures nothing;
    // given a posting, it keeps what the browser read and still fetches nothing.
    const capture = (body: object) =>
      analysis.evaluate(
        async ([webOrigin, json]) =>
          (await fetch(`${webOrigin}/api/job-offers`, { method: "POST", headers: { "content-type": "application/json" }, body: json })).status,
        [origin, JSON.stringify(body)] as const,
      );
    expect(await capture({ source: { url: `${careerSiteUrl}?ref=address-only` } })).toBe(400);
    expect(await capture({ source: { url: `${careerSiteUrl}?ref=with-text` }, title: "Contrôleur financier H/F", content: "Poste à Lyon." })).toBe(200);

    // The career site was read once, by the person's browser, when they opened the page.
    expect(careerSiteVisits).toHaveLength(1);
    expect(careerSiteVisits[0]!.headers["user-agent"]).toMatch(/Chrome\//);
    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
  });

  /** The worker's clean-up of Guest captures (ADR-0003), run as its schedule would at a later time. */
  const forgetGuestCapturesAt = (time: number) => {
    const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "guests.forget", String((time - Date.now()) / 3_600_000)], {
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
  };

  test("a Guest's Job Offer is kept for their session and forgotten by the worker within 24 hours, unlike a Candidate's", async ({ page }) => {
    // A Candidate captures a posting from the web app: theirs is never forgotten.
    await signInWithMagicLink(page, newAddress("guest-retention"));
    const kept = await page.request.post(`${origin}/api/job-offers`, {
      headers: { origin },
      data: { title: "Trésorier groupe H/F", content: `Poste de trésorier à Lyon (${Date.now()}).` },
    });
    expect(kept.status()).toBe(200);
    const candidateOffer = (await kept.json()) as { id: string };

    // A Guest captures and scores a posting from the badge.
    const capturedAt = Date.now();
    const boardPage = await context.newPage();
    await boardPage.goto(Object.keys(boardPages)[0]!);
    const [analysis] = await Promise.all([
      context.waitForEvent("page"),
      boardPage.getByRole("button", { name: fr.badgeLabel }).click(),
    ]);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();
    const { guestSession: stored } = await guestSession(analysis);
    const jobOffer = (id: string) => analysis.request.get(`${origin}/api/job-offers/${id}`);

    // Within the session, the Guest's Job Offer is kept.
    forgetGuestCapturesAt(capturedAt + 22 * 3_600_000);
    expect((await jobOffer(stored.jobOffer.id)).status()).toBe(200);

    // Less than 24 hours after the capture, it is gone; the Candidate's stays.
    forgetGuestCapturesAt(capturedAt + 23 * 3_600_000 + 60_000);
    expect((await jobOffer(stored.jobOffer.id)).status()).toBe(404);
    expect((await jobOffer(candidateOffer.id)).status()).toBe(200);
    // Reopening shows the kept Match Score (#51); a new one cannot be computed for an offer that is gone.
    await analysis.reload();
    await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
    await expect(analysis.getByText(fr.analysis.jobOfferGone)).toBeVisible();
    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
  });

  test("forgets the Guest session in the browser when it expires, even if the Guest never comes back to it", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([
      context.waitForEvent("page"),
      jobPage.getByRole("button", { name: fr.badgeLabel }).click(),
    ]);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();
    // The notice tells the Guest when their data goes: at most 24 hours from now.
    await expect(analysis.getByText(/^Vos données seront effacées au plus tard le /)).toBeVisible();

    // Bring the session's end to a few seconds from now, then leave it alone.
    await analysis.evaluate(async () => {
      type Storage = { get(key: string): Promise<Record<string, object>>; set(items: object): Promise<void> };
      const storage = (globalThis as unknown as { chrome: { storage: { session: Storage } } }).chrome.storage.session;
      const { guestSession } = await storage.get("guestSession");
      await storage.set({ guestSession: { ...guestSession, expiresAt: Date.now() + 3_000 } });
    });
    await analysis.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId()}/popup.html`);
    await expect.poll(() => guestSession(popup), { timeout: 30_000 }).toEqual({});

    const later = await context.newPage();
    await later.goto(`chrome-extension://${extensionId()}/analyse.html`);
    await expect(later.getByText(fr.analysis.noJobOffer)).toBeVisible();
  });

  test("tells a signed-in Candidate their Job Offer is kept in their account, not forgotten within 24 hours", async () => {
    const web = await context.newPage();
    await signInWithMagicLink(web, newAddress("extension-candidate"));
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);

    await expect(analysis.getByText(fr.analysis.candidateNotice)).toBeVisible();
    await expect(analysis.getByText(fr.analysis.guestNotice)).toHaveCount(0);
    await expect(analysis.getByText(/^Vos données seront effacées/)).toHaveCount(0);
    await expect(analysis.getByRole("link", { name: fr.analysis.signUp })).toHaveCount(0);

    await analysis.getByRole("button", { name: fr.analysis.forgetCv }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
  });

  // Issue #11: from the extension, a Guest signs up (or in) on the web app and keeps their work;
  // a signed-in Candidate captures straight into an Application on the Profile they choose.
  const applicationIn = async (page: Page, link: string) => {
    const id = new URL(link).pathname.split("/").pop()!;
    const response = await page.request.get(`${origin}/api/applications/${id}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as { status: string; profile: { id: string; name: string }; jobOffer: { title: string } };
  };

  test("a Guest who signs up from the extension keeps their work: their CV becomes their first Profile, the Job Offer their first Application", async () => {
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();
    await expect(analysis.getByText(fr.analysis.signUpHint)).toBeVisible();

    // Signing up happens on the web app, whose session the extension shares (ADR-0011).
    const [web] = await Promise.all([context.waitForEvent("page"), analysis.getByRole("link", { name: fr.analysis.signUp }).click()]);
    await expect(web).toHaveURL(`${origin}/connexion`);
    await signInWithMagicLink(web, newAddress("guest-sign-up"));

    // Back on the analysis page, the Guest's work is kept at once.
    await analysis.bringToFront();
    await expect(analysis.getByText(fr.analysis.saved)).toBeVisible({ timeout: 15_000 });
    await expect(analysis.getByText(/^Votre CV est devenu votre profil « .+ »\.$/)).toBeVisible();
    const link = analysis.getByRole("link", { name: fr.analysis.openApplication });
    const application = await applicationIn(web, (await link.getAttribute("href"))!);
    expect(application.status).toBe("to_apply");
    expect(application.jobOffer.title).toBe("Directeur administratif et financier H/F");
    const profiles = await (await web.request.get(`${origin}/api/profiles`)).json();
    expect(profiles).toEqual([{ id: application.profile.id, name: application.profile.name }]);
    // Now in the Candidate's account, the CV and the Job Offer leave the browser (ADR-0003).
    const { guestSession: left } = await guestSession(analysis);
    expect(left).not.toHaveProperty("cv");
    expect(left).not.toHaveProperty("jobOffer");

    // The web app shows it among the Candidate's Applications, "À postuler".
    await web.goto("/candidatures");
    await expect(web.getByText("Directeur administratif et financier H/F").first()).toBeVisible();
    await expectSavedInWebApp(web, (await link.getAttribute("href"))!, application.profile.id);

    // The Job Offer the Guest captured is now the Candidate's: the worker's clean-up of Guest captures, a day later, leaves it alone.
    forgetGuestCapturesAt(Date.now() + 25 * 3_600_000);
    expect((await applicationIn(web, (await link.getAttribute("href"))!)).jobOffer.title).toBe("Directeur administratif et financier H/F");
    await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
  });

  test("a Guest who signs up in another tab while the analysis page is still waiting on a Match Score keeps their work, without reopening it (#66)", async () => {
    const analysis = await captureFromBadge(postingUrl);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(scoreLine)).toBeVisible();

    // Another page of the extension holds the Match Score's lock and never lets it go: the analysis
    // page, opened again, never finishes its first render.
    const holder = await context.newPage();
    await holder.goto(`chrome-extension://${extensionId()}/popup.html`);
    await holder.evaluate(() => {
      void navigator.locks.request("jobbbox-match-score", () => new Promise(() => {}));
    });
    await analysis.reload();
    await expect(analysis.getByText(fr.analysis.scoring)).toBeVisible();

    try {
      // The page shows no sign-up link yet: the Guest signs up on the web app, in another tab.
      const web = await context.newPage();
      await web.goto(`${origin}/connexion`);
      await signInWithMagicLink(web, newAddress("guest-sign-up-stalled"));

      await analysis.bringToFront();
      await expect(analysis.getByText(fr.analysis.saved)).toBeVisible({ timeout: 15_000 });
      const link = analysis.getByRole("link", { name: fr.analysis.openApplication });
      const application = await applicationIn(web, (await link.getAttribute("href"))!);
      expect(application.status).toBe("to_apply");
      const profiles = await (await web.request.get(`${origin}/api/profiles`)).json();
      expect(profiles).toEqual([{ id: application.profile.id, name: application.profile.name }]);
      await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
    } finally {
      await holder.close();
    }
  });

  test("a Match Score request that never answers is given up after a bounded time, and can be tried again (#66)", async () => {
    const captured = await captureFromBadge(postingUrl);
    await captured.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await captured.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(captured.getByText(scoreLine)).toBeVisible();
    await captured.close();

    // The analysis page, opened again, on a clock the test moves forward.
    const analysis = await context.newPage();
    await analysis.clock.install();
    await analysis.goto(`chrome-extension://${extensionId()}/analyse.html`);
    await expect(analysis.getByText(scoreLine)).toBeVisible();

    // The web app takes the next Match Score request and never answers it.
    const stalled: { abort(): Promise<void> }[] = [];
    await context.route("**/api/match-score", async (route) => {
      if (stalled.length === 0) stalled.push(route);
      else await route.continue();
    });
    try {
      await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
      await expect(analysis.getByText(fr.analysis.scoring)).toBeVisible();
      await expect.poll(() => stalled.length).toBe(1);

      // A minute on, it is still waited for; past the bound, it is given up with the usual retry state.
      await analysis.clock.fastForward("01:00");
      await expect(analysis.getByText(fr.analysis.scoring)).toBeVisible();
      await analysis.clock.fastForward("02:00");
      await expect(analysis.getByRole("alert").filter({ hasText: fr.unreachable })).toBeVisible();
      await expect(analysis.getByText(fr.analysis.scoring)).toHaveCount(0);

      // Tried again while the stalled request is still open: the page waits on nothing left behind.
      await analysis.getByRole("button", { name: fr.analysis.rescore }).click();
      await expect(analysis.getByText(scoreLine)).toBeVisible();
      await expect(analysis.getByText(fr.unreachable)).toHaveCount(0);
    } finally {
      await context.unroute("**/api/match-score");
      await Promise.all(stalled.map((route) => route.abort().catch(() => {})));
    }
    // The next tests start from no Guest session.
    await analysis.getByRole("button", { name: fr.analysis.forget }).click();
    await expect(analysis.getByText(fr.analysis.forgotten)).toBeVisible();
    await analysis.close();
  });

  /** The web app shows the Application "À postuler", and the Profile's Master CV, version 1, read from the Guest's CV. */
  const expectSavedInWebApp = async (web: Page, applicationLink: string, profileId: string) => {
    await web.goto(new URL(applicationLink).pathname);
    await expect(web.getByRole("heading", { level: 1 })).toContainText("Directeur administratif et financier H/F");
    await expect(web.getByLabel(frCatalogue.application.statusLabel)).toHaveValue("to_apply");
    await expect(web.getByLabel(frCatalogue.application.statusLabel).locator("option:checked")).toHaveText(frCatalogue.applicationStatuses.to_apply);
    await web.goto(`/profils/${profileId}/cv`);
    await expect(web.getByText("Vous modifiez la version 1.")).toBeVisible();
    await expect(web.getByLabel(frCatalogue.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(web.getByLabel(frCatalogue.cvReview.headline)).toHaveValue("Directrice financière");
    await expect(web.getByLabel(frCatalogue.cvReview.employer).first()).toHaveValue("Groupe Seb");
  };

  test("a Guest who signs in to their existing account from the extension can turn their CV into a new Profile and the Job Offer into an Application", async () => {
    test.slow(); // two magic-link sign-ins, a subscription and a Profile before the Capture even starts
    // An existing Candidate with one Profile, on a Plan allowing more, who is signed out.
    const web = await context.newPage();
    const email = newAddress("guest-sign-in");
    await signInWithMagicLink(web, email);
    await subscribe(web, email, "standard");
    const masterCv = {
      fullName: "Marie Dupont", headline: "Contrôleuse de gestion", email: "", phone: "", location: "Lyon", summary: "",
      experience: [], education: [], skills: [], languages: [],
    };
    const existing = await web.request.post(`${origin}/api/profiles`, { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Contrôleuse de gestion", location: "Lyon" } } });
    expect(existing.status(), await existing.text()).toBe(201);
    const existingId = (await existing.json()).id as string;
    await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });

    // As a Guest, they capture a posting and score their CV.
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);
    await analysis.getByLabel(frCatalogue.cvUpload.fileLabel).setInputFiles(cvFile);
    await analysis.getByRole("button", { name: fr.analysis.submit }).click();
    await expect(analysis.getByText(/^Match Score : \d+ \/ 100$/)).toBeVisible();

    // They sign in on the web app, from the extension's link; the extension shares that session.
    const [signIn] = await Promise.all([context.waitForEvent("page"), analysis.getByRole("link", { name: fr.analysis.signUp }).click()]);
    await expect(signIn).toHaveURL(`${origin}/connexion`);
    await signInWithMagicLink(signIn, email);
    await analysis.bringToFront();

    // Having a Profile already, they choose: theirs, or a new one from this CV.
    const profile = analysis.getByLabel(fr.analysis.profileLabel);
    await expect(profile.getByRole("option")).toHaveText(["Contrôleuse de gestion", fr.analysis.newProfileFromCv], { timeout: 15_000 });
    await profile.selectOption({ label: fr.analysis.newProfileFromCv });
    await analysis.getByRole("button", { name: fr.analysis.save }).click();

    await expect(analysis.getByText(fr.analysis.saved)).toBeVisible();
    await expect(analysis.getByText(/^Votre CV est devenu votre profil « .+ »\.$/)).toBeVisible();
    const link = (await analysis.getByRole("link", { name: fr.analysis.openApplication }).getAttribute("href"))!;
    const application = await applicationIn(signIn, link);
    expect(application.status).toBe("to_apply");
    expect(application.profile.id).not.toBe(existingId);
    const profiles = (await (await signIn.request.get(`${origin}/api/profiles`)).json()) as { id: string }[];
    expect(profiles.map((p) => p.id)).toEqual([existingId, application.profile.id]);
    const { guestSession: left } = await guestSession(analysis);
    expect(left).not.toHaveProperty("cv");
    expect(left).not.toHaveProperty("jobOffer");

    await expectSavedInWebApp(signIn, link, application.profile.id);
    await signIn.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
  });

  test("a signed-in Candidate chooses the Profile and the captured Job Offer becomes an Application directly", async () => {
    const web = await context.newPage();
    const email = newAddress("extension-profiles");
    await signInWithMagicLink(web, email);
    await subscribe(web, email, "standard"); // more than the Free Plan's one Profile
    const masterCv = {
      fullName: "Marie Dupont", headline: "Directrice financière", email: "", phone: "", location: "Lyon", summary: "",
      experience: [], education: [], skills: ["IFRS"], languages: [],
    };
    const profileIds: string[] = [];
    // Two Profiles whose Master CVs match the posting's skills differently, so their Match Scores differ.
    for (const [targetRole, skills] of [["Directrice financière", ["IFRS", "Consolidation", "Power BI"]], ["Consultante transformation", []]] as const) {
      const data = { masterCv: { ...masterCv, skills }, searchCriteria: { targetRole, location: "Lyon" } };
      const created = await web.request.post(`${origin}/api/profiles`, { headers: { origin }, data });
      expect(created.status(), await created.text()).toBe(201);
      profileIds.push((await created.json()).id);
    }

    const scores = countScoreRequests();
    const jobPage = await context.newPage();
    await jobPage.goto(postingUrl);
    const [analysis] = await Promise.all([context.waitForEvent("page"), jobPage.getByRole("button", { name: fr.badgeLabel }).click()]);

    // Scored against their first Profile at once; switching the Profile scores the Job Offer against that one (#75).
    const scoredWith = analysis.getByLabel(fr.analysis.scoreProfileLabel);
    await expect(scoredWith.getByRole("option")).toHaveText(["Directrice financière", "Consultante transformation"]);
    await expect(analysis.getByText(fr.analysis.covered.replace("{{skills}}", "IFRS, Consolidation, Power BI"))).toBeVisible();
    const first = await analysis.getByText(scoreLine).textContent();
    await scoredWith.selectOption({ label: "Consultante transformation" });
    await expect(analysis.getByText(fr.analysis.covered.replace("{{skills}}", "IFRS, Consolidation, Power BI"))).toHaveCount(0);
    await expect(analysis.getByText(scoreLine)).not.toHaveText(first!);
    expect(scores.bodies.map((body) => body.profileId)).toEqual(profileIds);
    // Reopened, the page shows the Match Score kept for the Profile chosen, without asking for one.
    const second = await analysis.getByText(scoreLine).textContent();
    const reopened = await reopenAnalysis();
    await expect(reopened.getByLabel(fr.analysis.scoreProfileLabel)).toHaveValue(profileIds[1]!);
    await expect(reopened.getByText(scoreLine)).toHaveText(second!);
    await reopened.close();
    expect(scores.requests).toHaveLength(2);
    scores.stop();

    const profile = analysis.getByLabel(fr.analysis.profileLabel);
    await expect(profile.getByRole("option")).toHaveText(["Directrice financière", "Consultante transformation"]);
    await profile.selectOption({ label: "Consultante transformation" });
    await analysis.getByRole("button", { name: fr.analysis.save }).click();

    await expect(analysis.getByText(fr.analysis.saved)).toBeVisible();
    await expect(analysis.getByText(/^Votre CV est devenu/)).toHaveCount(0);
    const application = await applicationIn(web, (await analysis.getByRole("link", { name: fr.analysis.openApplication }).getAttribute("href"))!);
    expect(application).toMatchObject({ status: "to_apply", profile: { id: profileIds[1], name: "Consultante transformation" } });
    await web.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
  });
});
