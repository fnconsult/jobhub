import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { buildE2eExtension, e2eExtensionDir, unpackedExtensionId } from "./support/extension";

// The product owner's report of 2026-11-13: on a recruitment agency's posting (a WordPress job board, no JSON-LD
// JobPosting), « Capturer cette page » answered « Cette page ne peut pas être capturée… », and nothing reached the
// Back Office. The page was not the problem: the extension, a zip loaded unpacked from a new folder, had an id Chrome
// derives from that folder, which the web app's EXTENSION_ORIGINS did not list. Every call it makes with the
// Candidate's session (the Capture, the error report) was refused with a 403; only reading the session works.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")).extension;
const origin = process.env.E2E_WEB_ORIGIN!;

// A posting as a WordPress job board serves it (WP Job Manager's markup): no schema.org JobPosting, its address on no
// job board the extension knows, the description in an <article> inside <main>, « Postuler » in a sidebar. Served on a
// host the e2e build may read (JOB_SITES), as the product owner's browser could read every site (« Détecter les offres
// sur tous les sites »), at an address that is not a known posting page: nothing is detected, Capture is by hand.
const agencyPostingUrl = "https://agence-recrutement.teamtailor.com/job/account-executive-ia-senior-paris/";
const agencyPostingHtml = `<!doctype html><html lang="fr-FR"><head><meta charset="utf-8">
  <title>Account Executive IA – Agence de recrutement</title>
  <meta property="og:site_name" content="Agence de recrutement"><meta property="og:type" content="article">
  <meta name="generator" content="WordPress 6.8"></head>
  <body class="job_listing-template-default single single-job_listing">
  <header class="site-header"><nav><a href="/entreprise">Entreprise</a> <a href="/candidats">Candidat(e)</a></nav></header>
  <main id="primary" class="site-main">
    <article class="job_listing type-job_listing status-publish">
      <h1 class="entry-title">Account Executive IA</h1>
      <ul class="job-listing-meta"><li class="location">Paris</li><li>TT : 2-3j/semaine</li><li class="salary">70 + 30K€</li></ul>
      <div class="job_description">
        <p>Vous rejoignez une structure d'innovation technologique qui conçoit des agents IA pour le B2B.</p>
        <h2>Mission &amp; Résultats attendus :</h2>
        <p>Directement rattaché à la stratégie globale, vous portez la croissance de la solution sur le marché.</p>
      </div>
    </article>
  </main>
  <aside class="job-sidebar"><a class="application_button" href="#postuler">Postuler</a><h3>Partager cette Offre d'Emploi</h3></aside>
  </body></html>`;

/** A browser with the e2e build loaded from `dir`, the agency's posting served locally. */
async function browserWith(dir: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    locale: "fr-FR",
    baseURL: origin,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await context.route(agencyPostingUrl, (route) => route.fulfill({ contentType: "text/html", body: agencyPostingHtml }));
  return context;
}

/** « Capturer cette page » from the Side Panel (driven in a tab), the agency's posting in view. */
async function captureAgencyPosting(context: BrowserContext, extensionId: string) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(fr.analysis.title);
  const jobPage = await context.newPage();
  await jobPage.goto(agencyPostingUrl);
  await jobPage.bringToFront();
  await panel.getByRole("button", { name: fr.capturePage }).click();
  return panel;
}

test.describe("an extension installation the web app does not recognise", () => {
  test.beforeAll(() => {
    test.setTimeout(180_000);
    buildE2eExtension();
  });

  test("the agency's posting, from a recognised installation, is captured", async () => {
    const context = await browserWith(e2eExtensionDir);
    try {
      const panel = await captureAgencyPosting(context, unpackedExtensionId(e2eExtensionDir));
      await expect(panel.getByRole("heading", { level: 2, name: "Account Executive IA" })).toBeVisible();
      await expect(panel.getByText(fr.captureImpossible)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("the same build, loaded from another folder, says Jobbbox does not recognise it, not that the page cannot be captured", async () => {
    // The same files in another folder: Chrome gives them another id, which EXTENSION_ORIGINS does not list.
    const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), "jobbbox-unpacked-")));
    const dir = path.join(folder, "jobbbox-extension");
    cpSync(e2eExtensionDir, dir, { recursive: true });
    expect(unpackedExtensionId(dir)).not.toBe(unpackedExtensionId(e2eExtensionDir));
    const context = await browserWith(dir);
    try {
      const panel = await captureAgencyPosting(context, unpackedExtensionId(dir));
      await expect(panel.getByRole("status").filter({ hasText: fr.installationNotRecognised })).toBeVisible();
      await expect(panel.getByText(fr.captureImpossible)).toHaveCount(0);
      await expect(panel.getByRole("heading", { level: 2, name: "Account Executive IA" })).toHaveCount(0);
    } finally {
      await context.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
