import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #204: Back Office Roles. ADMIN_EMAILS members are permanent super-admins;
// they grant roles to existing accounts on the Administrateurs page. Each role
// reaches only its sections (the others are left out of the sidebar and answer
// 404), Support reads without saving, and every grant and revoke is in the Journal.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const page404 = fr.notFound.title;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "roles-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

/** Every Back Office section's path, and the sidebar label that leads to it. */
const SECTIONS = {
  signalements: "/admin/signalements",
  plans: "/admin/offres",
  planQuotas: "/admin/quotas",
  coupons: "/admin/codes-promo",
  humanCoaches: "/admin/coachs",
  coachCost: "/admin/cout-coach",
  coachingPlaybooks: "/admin/playbooks",
  guardrails: "/admin/garde-fous",
  unansweredQuestions: "/admin/questions-sans-reponse",
  providerSecrets: "/admin/cles",
  platformSettings: "/admin/parametres",
  signInProviders: "/admin/connexion",
  aiUsage: "/admin/consommation-ia",
  aiMessages: "/admin/journaux-ia",
  searchSites: "/admin/sites",
  tools: "/admin/outils",
  administrators: "/admin/administrateurs",
  journal: "/admin/journal",
} as const;
type Section = keyof typeof SECTIONS;

/** The Back Office Roles, in the order the app lists them. */
const ROLES = ["super-admin", "plans-manager", "coach-manager", "playbook-editor", "help-editor", "support"];

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

const backOfficeNav = (page: Page) => page.getByRole("navigation", { name: admin.nav.label });

/** The super-admin grants `roles` to the account with `email` on the Administrateurs page. */
async function grant(superAdmin: Page, email: string, roles: string[]) {
  await superAdmin.goto(SECTIONS.administrators);
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  for (const role of roles) await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  const named = ROLES.filter((role) => roles.includes(role)).map((role) => admin.roles[role]);
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: named.join(", ") }));
}

/** The super-admin revokes `role` from `email`. */
async function revoke(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto(SECTIONS.administrators);
  await superAdmin.getByRole("button", { name: tr(admin.administrators.revoke, { role: admin.roles[role], email }) }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(admin.administrators.revoked);
}

/** Checks `page` reaches exactly `allowed`: in the sidebar and by URL; every other section is absent and answers 404. */
async function expectSections(page: Page, allowed: Section[]) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(admin.title);
  const links = backOfficeNav(page).getByRole("link");
  // Signalements carries its « à traiter » count after its name, for those who change them (#376).
  await expect(links).toHaveText([...allowed.map((section) => (section === "signalements" ? new RegExp(`^${admin.sections[section]}`) : admin.sections[section])), admin.nav.account]);
  for (const [section, path] of Object.entries(SECTIONS) as [Section, string][]) {
    const response = await page.goto(path);
    if (allowed.includes(section)) {
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }), path).not.toHaveText(page404);
    } else {
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 }), path).toHaveText(page404);
    }
  }
}

/**
 * Replays a Back Office form's submission from `page`, as a hand-made request would:
 * the form's server action (its id read from `formPage`, where the form is shown)
 * with `fields`. Returns the response.
 */
async function submitAs(page: Page, formPage: Page, path: string, buttonName: string, fields: Record<string, string>) {
  await formPage.goto(path);
  const form = formPage.locator("form").filter({ has: formPage.getByRole("button", { name: buttonName }) });
  const actionField = await form.locator('input[name^="$ACTION_ID_"]').getAttribute("name");
  expect(actionField).toBeTruthy();
  return page.request.post(path, { headers: { origin }, multipart: { [actionField!]: "", ...fields }, maxRedirects: 0 });
}

test.describe("Back Office Roles", () => {
  test("an ADMIN_EMAILS member is a permanent super-admin: every section, marked permanent, never revocable", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await expectSections(page, ["signalements", "plans", "planQuotas", "coupons", "humanCoaches", "coachCost", "coachingPlaybooks", "guardrails", "unansweredQuestions", "providerSecrets", "platformSettings", "signInProviders", "aiUsage", "aiMessages", "searchSites", "tools", "administrators", "journal"]);

    await page.goto(SECTIONS.administrators);
    await expect(page).toHaveTitle(`${admin.administrators.title} · ${admin.title}`);
    // The sidebar names its groups; Plateforme holds Provider Secrets (Clés, #208), Sign-in Providers (Connexion, #209) and the search sites.
    for (const group of ["candidates", "offer", "coaching", "platform", "team"]) await expect(backOfficeNav(page).getByRole("heading", { name: admin.nav.groups[group] })).toBeVisible();
    await expect(backOfficeNav(page).getByRole("link", { name: admin.sections.administrators })).toHaveAttribute("aria-current", "page");

    const row = page.getByRole("row").filter({ hasText: SUPER_ADMIN });
    await expect(row).toContainText(`${admin.roles["super-admin"]} (${admin.administrators.permanent})`);
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("a super-admin grants roles to an existing account by email; an unknown email is refused", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);

    await page.goto(SECTIONS.administrators);
    await page.getByLabel(admin.administrators.grantEmail).fill(newAddress("no-account"));
    await page.getByRole("checkbox", { name: admin.roles.support }).check();
    await page.getByRole("button", { name: admin.administrators.grant }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(admin.administrators.errors.unknown_account);

    // The notice names roles only from their keys: nothing else from the address bar is shown.
    await page.goto(`${SECTIONS.administrators}?granted=${encodeURIComponent("<b>hacked</b>,support")}`);
    await expect(page.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles.support }));
    await page.goto(`${SECTIONS.administrators}?granted=hacked`);
    await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);

    const email = newAddress("granted");
    const person = await personPage(page.context().browser()!, email);
    await grant(page, email, ["support", "coach-manager"]);
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText(admin.roles["coach-manager"]);
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText(admin.roles.support);

    // Their next page already has the Back Office link, and the Back Office.
    await person.goto("/admin");
    await expect(person.getByRole("heading", { level: 1 })).toHaveText(admin.title);
  });

  test("each role reaches exactly its sections; Support reads without any way to save", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const plans = newAddress("plans-manager");
    const coaches = newAddress("coach-manager");
    const support = newAddress("support");
    const [plansPage, coachesPage, supportPage] = await Promise.all([personPage(browser, plans), personPage(browser, coaches), personPage(browser, support)]);
    await grant(page, plans, ["plans-manager"]);
    await grant(page, coaches, ["coach-manager"]);
    await grant(page, support, ["support"]);

    await expectSections(plansPage, ["plans", "planQuotas", "coupons"]);
    await plansPage.goto(SECTIONS.plans);
    await expect(plansPage.getByRole("button", { name: admin.plans.create })).toBeEnabled();
    await plansPage.goto(SECTIONS.planQuotas);
    await expect(plansPage.getByRole("button", { name: tr(admin.planQuotas.save, { plan: fr.billing.plans.premium }) })).toBeEnabled();

    await expectSections(coachesPage, ["humanCoaches", "coachCost"]);
    await coachesPage.goto(SECTIONS.humanCoaches);
    await expect(coachesPage.getByRole("button", { name: admin.humanCoaches.add })).toBeVisible();

    await expectSections(supportPage, ["signalements", "plans", "planQuotas", "coupons", "humanCoaches", "coachCost", "coachingPlaybooks", "guardrails", "unansweredQuestions", "platformSettings", "signInProviders", "aiUsage", "searchSites", "tools"]);
    await supportPage.goto(SECTIONS.plans);
    await expect(supportPage.getByText(admin.readOnly)).toBeVisible();
    await expect(supportPage.getByRole("main").locator("form")).toHaveCount(0);
    await supportPage.goto(SECTIONS.planQuotas);
    await expect(supportPage.getByText(admin.readOnly)).toBeVisible();
    await expect(supportPage.getByRole("button")).not.toContainText([admin.planQuotas.save.split(" {{")[0]!]);
    await expect(supportPage.getByLabel(fr.billing.quotas.matchScores, { exact: false }).first()).toBeDisabled();
    // Read only: the values show, but there is no form to send.
    await expect(supportPage.getByRole("main").locator("form")).toHaveCount(0);
    await supportPage.goto(SECTIONS.humanCoaches);
    await expect(supportPage.getByText(admin.readOnly)).toBeVisible();
    // The add and retire controls show, disabled, with no form behind them.
    await expect(supportPage.getByRole("button", { name: admin.humanCoaches.add })).toBeDisabled();
    await expect(supportPage.getByLabel(admin.humanCoaches.name)).toBeDisabled();
    for (const retire of await supportPage.getByRole("button", { name: tr(admin.humanCoaches.retire, { name: "" }) }).all()) await expect(retire).toBeDisabled();
    await expect(supportPage.getByRole("main").locator("form")).toHaveCount(0);
    await supportPage.goto(SECTIONS.searchSites);
    await expect(supportPage.getByText(admin.readOnly)).toBeVisible();
    // The sites and their state show; every switch and the add forms are disabled, with no form behind them.
    const disableFranceTravail = tr(admin.searchSites.disable, { name: admin.searchSites.sources.names.france_travail });
    await expect(supportPage.getByRole("button", { name: disableFranceTravail })).toBeDisabled();
    await expect(supportPage.getByRole("button", { name: admin.searchSites.discoverySites.add, exact: true })).toBeDisabled();
    await expect(supportPage.getByLabel(admin.searchSites.jobSites.pattern)).toBeDisabled();
    await expect(supportPage.getByRole("main").locator("form")).toHaveCount(0);
    // Sent by hand, Support's switch is refused on the server, and the source stays enabled.
    const switched = await submitAs(supportPage, page, SECTIONS.searchSites, disableFranceTravail, { source: "france_travail", enabled: "false" });
    expect(switched.status()).toBe(404);
    await page.goto(SECTIONS.searchSites);
    await expect(page.getByRole("button", { name: disableFranceTravail })).toBeEnabled();

    // Nor can Support save by sending the form by hand: the write is refused on the server.
    const refused = await submitAs(supportPage, page, SECTIONS.planQuotas, tr(admin.planQuotas.save, { plan: fr.billing.plans.premium }), {
      plan: "premium",
      profiles: "1",
      matchScores: "1",
      atsScores: "1",
      enrichedContacts: "1",
      jobDigest: "weekly",
    });
    expect(refused.status()).toBe(404);
  });

  test("revoking a role takes effect on the next request", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("revoked");
    const person = await personPage(browser, email);
    await grant(page, email, ["coach-manager"]);
    expect((await person.goto(SECTIONS.humanCoaches))?.status()).toBe(200);

    await revoke(page, email, "coach-manager");

    expect((await person.goto(SECTIONS.humanCoaches))?.status()).toBe(404);
    expect((await person.goto("/admin"))?.status()).toBe(404);
    // Still signed in: nobody is signed out.
    await person.goto("/compte");
    await expect(person).toHaveURL(/\/compte$/);
  });

  test("a super-admin cannot remove their own super-admin role, nor a permanent one", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("second-super-admin");
    const second = await personPage(browser, email);
    await grant(page, email, ["super-admin"]);

    await second.goto(SECTIONS.administrators);
    // No button for their own super-admin role, nor for the permanent super-admin's.
    await expect(second.getByRole("row").filter({ hasText: email }).getByRole("button")).toHaveCount(0);
    await expect(second.getByRole("row").filter({ hasText: SUPER_ADMIN }).getByRole("button")).toHaveCount(0);

    // Sent by hand (the revoke form the permanent super-admin sees for them), the server refuses too.
    const ownId = await second.evaluate(async () => (await (await fetch("/api/auth/get-session")).json()).user.id as string);
    const refused = await submitAs(second, page, SECTIONS.administrators, tr(admin.administrators.revoke, { role: admin.roles["super-admin"], email }), {
      candidateId: ownId,
      role: "super-admin",
    });
    expect(refused.headers()["location"] ?? refused.headers()["x-action-redirect"]).toContain("error=own_super_admin");
    await second.goto(SECTIONS.administrators);
    await expect(second.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(admin.administrators.title);
  });

  test("only super-admins can grant or revoke: other roles cannot raise themselves", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("escalation");
    const person = await personPage(browser, email);
    await grant(page, email, ["plans-manager", "coach-manager", "support"]);

    // Sent by a super-admin, the same hand-made request grants (it does reach the form's action)...
    const other = newAddress("escalation-control");
    await personPage(browser, other);
    const accepted = await submitAs(page, page, SECTIONS.administrators, admin.administrators.grant, { email: other, roles: "support" });
    expect(accepted.status()).toBe(303);
    await page.goto(SECTIONS.administrators);
    await expect(page.getByRole("row").filter({ hasText: other })).toContainText(admin.roles.support);

    // ...sent by anyone else, it is refused.
    const refused = await submitAs(person, page, SECTIONS.administrators, admin.administrators.grant, { email, roles: "super-admin" });
    expect(refused.status()).toBe(404);

    await page.goto(SECTIONS.administrators);
    await expect(page.getByRole("row").filter({ hasText: email })).not.toContainText(admin.roles["super-admin"]);
    expect((await person.goto(SECTIONS.administrators))?.status()).toBe(404);
  });

  test("grants and revokes are in the Journal, which only super-admins read", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("journal-roles");
    const person = await personPage(browser, email);
    await grant(page, email, ["support"]);
    await grant(page, email, ["coach-manager"]);
    await revoke(page, email, "support");

    await page.goto(`${SECTIONS.journal}?section=roles`);
    const rows = page.getByRole("row").filter({ hasText: email });
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(admin.journal.actions.updated);
    await expect(rows.nth(0)).toContainText(
      tr(admin.journal.changed, { field: admin.administrators.roles, before: `${admin.roles["coach-manager"]}, ${admin.roles.support}`, after: admin.roles["coach-manager"] }),
    );
    await expect(rows.nth(2)).toContainText(admin.journal.actions.added);
    await expect(rows.nth(2)).toContainText(tr(admin.journal.set, { field: admin.administrators.roles, after: admin.roles.support }));
    for (const index of [0, 1, 2]) {
      await expect(rows.nth(index)).toContainText(SUPER_ADMIN);
      await expect(rows.nth(index)).toContainText(admin.journal.sections.roles);
    }

    // A Coach manager does not read it.
    expect((await person.goto(SECTIONS.journal))?.status()).toBe(404);
  });

  test("an Administrator opening a section outside their roles is in the Journal, once a minute; a Candidate with no role is not (#264)", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("denied-support");
    const supportPage = await personPage(browser, support);
    await grant(page, support, ["support"]);
    const candidate = newAddress("denied-candidate");
    const candidatePage = await personPage(browser, candidate);
    // One entry per minute: the page and its reload must fall in the same one (the server's clock is this machine's).
    const second = new Date().getSeconds();
    if (second >= 45) await page.waitForTimeout((61 - second) * 1000);

    expect((await supportPage.goto(SECTIONS.aiMessages))?.status()).toBe(404);
    expect((await supportPage.reload())?.status()).toBe(404);
    expect((await candidatePage.goto("/admin"))?.status()).toBe(404);

    await page.goto(`${SECTIONS.journal}?section=ai_messages&outcome=failed`);
    const denied = page.getByRole("row").filter({ hasText: support });
    await expect(denied).toHaveCount(1);
    await expect(denied).toContainText(admin.journal.sections.ai_messages);
    await expect(denied).toContainText(SECTIONS.aiMessages);
    await expect(denied).toContainText(admin.journal.actions.denied);
    await expect(denied).toContainText(admin.journal.outcomes.failed);
    await expect(denied).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.viewed, reason: fr.failureReasons.role_missing }));
    // Nobody to attribute it to: a Candidate with no Back Office Role leaves nothing.
    await page.goto(SECTIONS.journal);
    await expect(page.getByRole("row").filter({ hasText: candidate })).toHaveCount(0);
  });
});
