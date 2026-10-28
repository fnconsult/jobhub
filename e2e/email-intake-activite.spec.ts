import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { alertEmail, inboundPayload, unknownSenderEmail } from "../apps/web/src/email-intake/fixtures/brevo-inbound";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #449 / ADR-0051: Email intake in the Back Office. A Candidate switches Email intake on and Brevo delivers two
// emails to their Forwarding address (fictional payloads from the fixtures); a third row stands for an email the worker
// read (#445). Super-admins and Support read every row in Activité › Emails reçus, naming no Candidate; the Journal's
// Boîtes reliées filter lists the Linked mailbox switched on, naming no one either.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const received = admin.receivedEmails;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "emails-recus-office@e2e.jobbbox.test";
const SECRET = "e2e-brevo-inbound-secret";
const BREVO_IP = "203.0.113.7"; // inside EMAIL_INTAKE_BREVO_IP_RANGES (playwright.config.ts)
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** The sender's domain of the email the worker read: this run's own, so rows of other specs are told apart. */
const READ_DOMAIN = `alertes-${tag}.example-jobs.test`;

const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(() => database.end());

const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants Support to the account with `email` on the Administrateurs page. */
async function grantSupport(superAdmin: Page, email: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles.support }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles.support }));
}

test.describe("Back Office Activité › Emails reçus and the Journal's Boîtes reliées (#449)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const candidateEmail = newAddress("emails-recus-candidate");
  let address: string;

  test.beforeAll(async ({ browser }) => {
    const candidate = await personPage(browser, candidateEmail);
    const on = await candidate.request.put("/api/account/email-intake", { headers: { origin } });
    expect(on.status()).toBe(200);
    address = (await on.json()).address;
    const delivered = await candidate.request.post("/api/email-intake/inbound", {
      headers: { "x-forwarded-for": BREVO_IP, "x-inbound-secret": SECRET },
      data: inboundPayload(alertEmail(address), unknownSenderEmail(address)),
    });
    expect(delivered.status()).toBe(200);
    // An email the worker read (#445): its kind, offers, outcome and Guardrail verdict.
    await database.query(
      `INSERT INTO received_email_activity (received_at, sender_domain, kind, new_offers, already_stored, outcome, guardrail)
       VALUES (now() - interval '1 hour', $1, 'recruiter', 3, 1, 'offers_found', 'flagged')`,
      [READ_DOMAIN],
    );
    await candidate.context().close();
  });

  /** Every row of Emails reçus shown, as text. */
  const shownRows = (page: Page) => page.getByTestId("received-emails").locator("tbody tr");

  async function expectSeededRows(page: Page) {
    await page.goto("/admin/activite/emails-recus?periode=all");
    await expect(page.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link", { name: admin.activity.tabs.receivedEmails })).toHaveAttribute("aria-current", "page");
    const read = shownRows(page).filter({ hasText: READ_DOMAIN });
    await expect(read).toContainText(received.kinds.recruiter);
    await expect(read).toContainText(tr(received.offersValue, { new: 3, alreadyStored: 1 }));
    await expect(read).toContainText(received.outcomes.offers_found);
    await expect(read).toContainText(received.guardrails.flagged);
    await expect(shownRows(page).filter({ hasText: "alertes.cadremploi.fr" }).first()).toContainText(received.outcomes.awaiting_reading);
    await expect(shownRows(page).filter({ hasText: "cabinet-fictif.test" }).first()).toContainText(received.outcomes.unrecognised_sender);
    const table = (await page.getByTestId("received-emails").textContent()) ?? "";
    expect(table).not.toContain(candidateEmail);
    expect(table).not.toContain(address);
  }

  test("a super-admin reads every row, naming no Candidate, and filters them", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);

    await expectSeededRows(office);

    await office.getByLabel(received.outcome).selectOption("offers_found");
    await office.getByRole("button", { name: received.apply }).click();
    await expect(office).toHaveURL(/resultat=offers_found/);
    await expect(shownRows(office).filter({ hasText: READ_DOMAIN })).toHaveCount(1);
    await expect(shownRows(office).filter({ hasText: "cabinet-fictif.test" })).toHaveCount(0);
  });

  test("Support reads them too, but not the Journal", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);
    const email = newAddress("emails-recus-support");
    const support = await personPage(browser, email);
    await grantSupport(office, email);

    await expectSeededRows(support);
    expect((await support.goto("/admin/activite/actions?section=linked_mailboxes"))?.status()).toBe(404);
  });

  test("the Journal's Boîtes reliées filter lists the Linked mailbox switched on, naming no one", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);

    await office.goto("/admin/activite/actions");
    await office.getByRole("navigation", { name: admin.journal.filter }).getByRole("link", { name: admin.journal.linkedMailboxes }).click();

    await expect(office).toHaveURL(/section=linked_mailboxes/);
    const switchedOn = office.locator('tr[data-kind="linked-mailbox"]').filter({ hasText: admin.journal.linkedMailboxEvents.switched_on });
    await expect(switchedOn.first()).toContainText(admin.journal.byCandidate);
    const journal = (await office.getByRole("table").textContent()) ?? "";
    expect(journal).not.toContain(candidateEmail);
    expect(journal).not.toContain(address);
  });
});
