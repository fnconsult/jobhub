import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #925: Activité › Extension. Demonstration Extension Events (#924) of this run's own Extension Version, written
// as the web app writes them: a Candidate's Capture and failed call, a Guest's CV draft and page that cannot be captured.
// A super-admin lists them, newest first, a Guest shown « Invité »; filters them by type (« Erreurs »), Candidate or
// Invité, version and domain, and follows a Candidate's link to theirs alone. Support reads the tab too, as it reads
// Activité. (The Dashboard's Extension card: its pure builder's tests; its screenshot: back-office-pages-screenshots.)
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const tab = admin.extensionEvents;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "extension-office@e2e.jobbbox.test";

/** This run's Extension Version: only its rows are listed once filtered by it, whatever else the suite recorded. */
const VERSION = `0.${1 + Math.floor(Math.random() * 9998)}.925`;
/** The page this run could not capture: its own domain, under a parent the domain filter is tried with. */
const PARENT_DOMAIN = `jobs-${Date.now().toString(36)}.example`;
const DOMAIN = `www.${PARENT_DOMAIN}`;
const JOB_OFFER = "0b6c2f1e-9250-4925-8925-000000000925";

const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(() => database.end());

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

test.describe("Back Office Activité › Extension (#925)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const candidateEmail = newAddress("extension-tab-candidate");

  test.beforeAll(async ({ browser }) => {
    const candidate = await personPage(browser, candidateEmail);
    await candidate.context().close();
    const { rows } = await database.query<{ id: string }>(`SELECT id FROM candidate WHERE lower(email) = lower($1)`, [candidateEmail]);
    const candidateId = rows[0]!.id;
    const insert = (ago: string, kind: string, who: string | null, more: Record<string, string | number> = {}) =>
      database.query(
        `INSERT INTO extension_event (at, kind, candidate_id, extension_version, object_type, object_id, error_code, message_key, route, http_status, place, browser, page_domain)
         VALUES (now() - $1::interval, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ago, kind, who, VERSION, more.objectType ?? null, more.objectId ?? null, more.code ?? null, more.messageKey ?? null, more.route ?? null, more.status ?? null, more.place ?? null, more.browser ?? null, more.domain ?? null],
      );
    // Oldest first: the tab lists them the other way round.
    await insert("4 minutes", "capture", candidateId, { objectType: "job_offer", objectId: JOB_OFFER });
    await insert("3 minutes", "cv_draft", null);
    await insert("2 minutes", "error", null, { code: "captureImpossible", messageKey: "extension.captureImpossible", place: "content_script", browser: "Chrome 141", domain: DOMAIN });
    await insert("1 minute", "error", candidateId, { code: "callFailed", route: "/api/match-score", status: 502, place: "side_panel", browser: "Edge 140", domain: "fr.indeed.com" });
  });

  const table = (page: Page) => page.getByTestId("extension-events");
  const shownRows = (page: Page): Locator => table(page).locator("tbody tr");
  const kinds = (page: Page) => shownRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));

  test("a super-admin lists the demonstration Extension Events, newest first; a Guest is shown « Invité »", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);

    await office.goto(`/admin/activite/extension?version=${VERSION}`);

    await expect(office.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link", { name: admin.activity.tabs.extensionEvents })).toHaveAttribute("aria-current", "page");
    await expect(shownRows(office)).toHaveCount(4);
    expect(await kinds(office)).toEqual(["error", "error", "cv_draft", "capture"]);
    const [failedCall, captureImpossible, cvDraft, capture] = [0, 1, 2, 3].map((index) => shownRows(office).nth(index));
    await expect(failedCall!).toContainText(candidateEmail);
    await expect(failedCall!).toContainText("callFailed");
    await expect(failedCall!).toContainText(tr(tab.routeStatus, { route: "/api/match-score", status: 502 }));
    await expect(failedCall!).toContainText(tab.places.side_panel);
    await expect(failedCall!).toContainText("Edge 140");
    for (const guest of [captureImpossible!, cvDraft!]) await expect(guest.getByRole("cell").nth(1)).toHaveText(tab.guest);
    await expect(captureImpossible!).toContainText("captureImpossible");
    await expect(captureImpossible!).toContainText(DOMAIN);
    await expect(captureImpossible!).toContainText(tab.places.content_script);
    await expect(cvDraft!).toContainText(tab.kinds.cv_draft);
    await expect(cvDraft!).toContainText(VERSION);
    await expect(capture!).toContainText(tab.kinds.capture);
    await expect(capture!.getByRole("link", { name: new RegExp(`^${tab.objects.job_offer}`) })).toHaveAttribute("href", `/offres/${JOB_OFFER}`);
    // A Guest's rows name no one.
    for (const guest of [captureImpossible!, cvDraft!]) await expect(guest).not.toContainText("@");
  });

  test("filters them by type (« Erreurs »), Candidate or Invité and domain, and keeps the version", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);
    await office.goto(`/admin/activite/extension?version=${VERSION}`);
    const filter = office.getByRole("form", { name: tab.filter });

    await filter.getByLabel(tab.kind).selectOption({ label: tab.errorsFilter });
    await filter.getByRole("button", { name: tab.apply }).click();
    await expect(office).toHaveURL(/type=error/);
    await expect(shownRows(office)).toHaveCount(2);
    expect(await kinds(office)).toEqual(["error", "error"]);

    await office.getByRole("form", { name: tab.filter }).getByLabel(tab.who).selectOption({ label: tab.whos.guest });
    await office.getByRole("form", { name: tab.filter }).getByRole("button", { name: tab.apply }).click();
    await expect(office).toHaveURL(/qui=guest/);
    await expect(shownRows(office)).toHaveCount(1);
    await expect(shownRows(office).first()).toContainText(DOMAIN);
    await expect(shownRows(office).first().getByRole("cell").nth(1)).toHaveText(tab.guest);

    await office.goto(`/admin/activite/extension?version=${VERSION}`);
    await office.getByRole("form", { name: tab.filter }).getByLabel(tab.domain).fill(PARENT_DOMAIN);
    await office.getByRole("form", { name: tab.filter }).getByRole("button", { name: tab.apply }).click();
    await expect(office).toHaveURL(new RegExp(`domaine=${PARENT_DOMAIN.replace(/\./g, "\\.")}`));
    await expect(shownRows(office)).toHaveCount(1);
    await expect(shownRows(office).first()).toContainText("captureImpossible");

    await office.goto(`/admin/activite/extension?version=${VERSION}&qui=candidate`);
    expect(await kinds(office)).toEqual(["error", "capture"]);
    await expect(shownRows(office).filter({ hasText: tab.guest })).toHaveCount(0);
  });

  test("a Candidate's link shows their Extension Events alone", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);
    await office.goto(`/admin/activite/extension?version=${VERSION}`);

    await shownRows(office).first().getByRole("link", { name: tr(tab.candidateLink, { email: candidateEmail }) }).click();

    await expect(office).toHaveURL(/candidat=/);
    await expect(office.getByRole("status").filter({ hasText: tab.ofCandidate })).toBeVisible();
    await expect(shownRows(office)).toHaveCount(2);
    await expect(shownRows(office).filter({ hasText: candidateEmail })).toHaveCount(2);
  });

  test("Support reads it too, as it reads Activité", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);
    const email = newAddress("extension-tab-support");
    const support = await personPage(browser, email);
    await office.goto("/admin/administrateurs");
    await office.getByLabel(admin.administrators.grantEmail).fill(email);
    await office.getByRole("checkbox", { name: admin.roles.support }).check();
    await office.getByRole("button", { name: admin.administrators.grant }).click();
    await expect(office.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles.support }));

    await support.goto(`/admin/activite/extension?version=${VERSION}`);
    await expect(shownRows(support)).toHaveCount(4);
    await expect(support.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link", { name: admin.activity.tabs.extensionEvents })).toBeVisible();
  });
});
