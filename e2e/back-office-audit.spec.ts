import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #203: every change made in the Back Office is recorded in the Back Office
// Audit, which Administrators read on the Journal page, newest first, by section.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const journal = fr.admin.journal;
// Its own Administrator: two sign-ins of one address at once can pick up each other's link.
const ADMINISTRATOR = "journal-office@e2e.jobbbox.test";
// An Administrator who deletes their own account, and one who only reads.
const DEPARTING = "audit-departing-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

test.describe("the Back Office Journal", () => {
  test("is hidden from Candidates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("curious"));
    for (const path of ["/admin/journal", "/admin/journal?section=plan_quotas"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);
      await expect(page).toHaveTitle(`${fr.errorPage.notFound.title} · ${fr.app.name}`);
    }
  });

  test("lists the changes Administrators made, newest first, and by section", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    const name = `Sophie Martin ${unique()}`;
    const email = newAddress("journal-coach");

    // Add a Human Coach, then retire them.
    await page.goto("/admin/coachs");
    await page.getByLabel(fr.admin.humanCoaches.name).fill(name);
    await page.getByLabel(fr.admin.humanCoaches.email).fill(email);
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(page.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
    await page.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }).click();
    await expect(page.getByRole("status")).toHaveText(fr.admin.humanCoaches.retired);

    // Save the Premium Plan's quotas as they are (other tests rely on them).
    await page.goto("/admin/quotas");
    await page.getByRole("button", { name: "Enregistrer l'offre Premium" }).click();
    await expect(page.getByRole("status")).toHaveText("Quotas de l'offre Premium enregistrés.");

    await page.goto("/admin");
    // Activité › Actions des administrateurs (#404): its sidebar entry, then its tab.
    await page.getByRole("navigation", { name: fr.admin.nav.label }).getByRole("link", { name: fr.admin.sections.activity, exact: true }).click();
    await page.getByRole("navigation", { name: fr.admin.activity.tabsLabel }).getByRole("link", { name: fr.admin.activity.tabs.audit }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.admin.activity.title);
    await expect(page).toHaveTitle(`${fr.admin.activity.tabs.audit} · ${fr.admin.activity.title} · ${fr.admin.title}`);

    const coachRows = page.getByRole("row").filter({ hasText: email });
    await expect(coachRows).toHaveCount(2);
    await expect(coachRows.nth(0)).toContainText(journal.actions.retired);
    await expect(coachRows.nth(1)).toContainText(journal.actions.added);
    for (const row of [coachRows.nth(0), coachRows.nth(1)]) {
      await expect(row).toContainText(ADMINISTRATOR);
      await expect(row).toContainText(journal.sections.human_coaches);
    }
    await expect(coachRows.nth(1)).toContainText(tr(journal.set, { field: fr.admin.humanCoaches.name, after: name }));
    const premium = page.getByRole("row").filter({ hasText: ADMINISTRATOR }).filter({ hasText: fr.billing.plans.premium }).first();
    await expect(premium).toContainText(journal.unchanged);

    const nav = page.getByRole("navigation", { name: journal.filter });
    await nav.getByRole("link", { name: journal.sections.human_coaches }).click();
    await expect(page).toHaveURL(/\/admin\/activite\/actions\?section=human_coaches$/);
    await expect(nav.getByRole("link", { name: journal.sections.human_coaches })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(2);
    await expect(page.getByRole("row").filter({ hasText: journal.sections.plan_quotas })).toHaveCount(0);

    await nav.getByRole("link", { name: journal.sections.plan_quotas }).click();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: ADMINISTRATOR }).filter({ hasText: fr.billing.plans.premium }).first()).toBeVisible();
  });

  test("records each search-sites change: the source or site, and its state before and after", async ({ page }) => {
    const sites = fr.admin.searchSites;
    const domain = `audit-${unique()}.fr`;
    const franceTravail = sites.sources.names.france_travail;
    await signInWithMagicLink(page, ADMINISTRATOR);

    // Job discovery sites are on Paramètres' Recherche web tab, the sources on its Sources tab (#396).
    await page.goto("/admin/parametres?tab=recherche-web");
    await page.getByLabel(sites.discoverySites.domain).fill(domain);
    await page.getByRole("button", { name: sites.discoverySites.add, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(sites.notices.siteAdded);
    await page.getByRole("button", { name: tr(sites.disable, { name: domain }) }).click();
    await expect(page.getByRole("status")).toHaveText(sites.notices.saved);
    await page.getByRole("button", { name: tr(sites.remove, { name: domain }) }).click();
    await expect(page.getByRole("status")).toHaveText(sites.notices.siteRemoved);
    // Switch a Job discovery source off, then on again (other tests rely on it).
    await page.goto("/admin/parametres?tab=sources");
    // The tab also says how many of its settings come from env (the e2e server's Job discovery budget).
    await page.getByRole("button", { name: tr(sites.disable, { name: franceTravail }) }).click();
    await expect(page.getByRole("status").filter({ hasText: sites.notices.saved })).toHaveText(sites.notices.saved);
    await page.getByRole("button", { name: tr(sites.enable, { name: franceTravail }) }).click();
    await expect(page.getByRole("status").filter({ hasText: sites.notices.saved })).toHaveText(sites.notices.saved);

    await page.goto("/admin/journal?section=job_discovery_sites");
    const siteRows = page.getByRole("row").filter({ hasText: domain });
    await expect(siteRows).toHaveCount(3);
    await expect(siteRows.nth(0)).toContainText(journal.actions.removed);
    await expect(siteRows.nth(0)).toContainText(tr(journal.removed, { field: sites.status, before: sites.disabled }));
    await expect(siteRows.nth(1)).toContainText(journal.actions.updated);
    await expect(siteRows.nth(1)).toContainText(tr(journal.changed, { field: sites.status, before: sites.enabled, after: sites.disabled }));
    await expect(siteRows.nth(2)).toContainText(journal.actions.added);
    await expect(siteRows.nth(2)).toContainText(tr(journal.set, { field: sites.status, after: sites.enabled }));
    for (const row of await siteRows.all()) {
      await expect(row).toContainText(ADMINISTRATOR);
      await expect(row).toContainText(journal.sections.job_discovery_sites);
    }

    await page.goto("/admin/journal?section=job_discovery_sources");
    const sourceRows = page.getByRole("row").filter({ hasText: ADMINISTRATOR }).filter({ hasText: franceTravail });
    await expect(sourceRows.nth(0)).toContainText(tr(journal.changed, { field: sites.status, before: sites.disabled, after: sites.enabled }));
    await expect(sourceRows.nth(1)).toContainText(tr(journal.changed, { field: sites.status, before: sites.enabled, after: sites.disabled }));
  });

  async function addCoach(page: Page, name: string, email: string) {
    await page.goto("/admin/coachs");
    await page.getByLabel(fr.admin.humanCoaches.name).fill(name);
    await page.getByLabel(fr.admin.humanCoaches.email).fill(email);
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  }

  test("a failed write leaves no entry in the Journal", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    const email = newAddress("journal-twice");
    await addCoach(page, `Sophie Martin ${unique()}`, email);
    await expect(page.getByRole("status")).toBeVisible();
    // Same email again: refused, nothing recorded.
    await addCoach(page, `Autre Coach ${unique()}`, email);
    await expect(page.getByRole("alert").filter({ hasText: fr.admin.humanCoaches.emailTaken })).toBeVisible();
    await page.goto("/admin/journal?section=human_coaches");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Autre Coach" })).toHaveCount(0);
  });

  test("an Administrator who deletes their account keeps their entries, with their email, and the export stays unchanged", async ({ page, browser }) => {
    await signInWithMagicLink(page, DEPARTING);
    const before = Object.keys(await (await page.request.get("/api/account/export")).json()).sort();
    const name = `Départ ${unique()}`;
    const email = newAddress("journal-departing");
    await addCoach(page, name, email);
    await expect(page.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
    const exportRes = await page.request.get("/api/account/export");
    const exportText = await exportRes.text();
    expect(Object.keys(JSON.parse(exportText)).sort()).toEqual(before);
    expect(exportText).not.toContain(email);

    const deleted = await page.request.delete("/api/account", { data: { email: DEPARTING }, headers: { origin } });
    expect(deleted.status(), await deleted.text()).toBe(204);

    const reader = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(reader, ADMINISTRATOR);
    await reader.goto("/admin/journal?section=human_coaches");
    const row = reader.getByRole("row").filter({ hasText: email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(DEPARTING);
    await expect(row).toContainText(journal.accountDeleted);
    await reader.close();
  });

  test("the privacy register lists the Back Office Audit", () => {
    const register = readFileSync("docs/privacy/register.md", "utf8");
    expect(register).toContain("/admin/journal");
    expect(register).toMatch(/Back Office Audit/);
    expect(register).toMatch(/3 years|3 ans/);
  });

  // Last: the purge empties the Journal of everything older than 3 years at the worker's clock.
  test("the worker purges entries older than 3 years", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    const email = newAddress("journal-purged");
    await addCoach(page, `Ancien ${unique()}`, email);
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto("/admin/journal");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(1);

    // Two years on: still kept.
    const run = (hours: number) =>
      spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "back-office-audit.purge", String(hours)], {
        env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, MAIL_TRANSPORT: "console" },
        encoding: "utf8",
      });
    const early = run(2 * 365 * 24);
    expect(early.status, early.stderr).toBe(0);
    await page.goto("/admin/journal");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(1);

    // Three years and a few days on: purged.
    const late = run(3 * 366 * 24 + 48);
    expect(late.status, late.stderr).toBe(0);
    await page.goto("/admin/journal");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
  });
});
