import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { alertEmail, inboundPayload, unknownSenderEmail, type BrevoInboundItem } from "../apps/web/src/email-intake/fixtures/brevo-inbound";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #442 / ADR-0050, ADR-0051: Brevo Inbound Parsing posts the emails sent to a Candidate's Forwarding address to
// POST /api/email-intake/inbound. Driven over HTTP as Brevo would (fictional payloads from the fixtures), observed through
// the Candidate's Data export, the job queue and the database; the worker's purge is run by e2e/support/worker-job.ts.
const origin = process.env.E2E_WEB_ORIGIN!;
const SECRET = "e2e-brevo-inbound-secret";
const BREVO_IP = "203.0.113.7"; // inside EMAIL_INTAKE_BREVO_IP_RANGES (playwright.config.ts)
const OTHER_IP = "198.51.100.9"; // outside
const READ_QUEUE = "email-intake.read";

// Issue #448: Email intake on the Sources tab and its sheet, in this file because switching the source off discards the
// emails the tests above deliver: the tests of one file run one after the other.
const admin = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")).admin;
const sites = admin.searchSites;
const senders = admin.emailIntake.senders;
const journal = admin.journal;
const SUPER_ADMIN = "email-intake-office@e2e.jobbbox.test";
const SOURCE_NAME: string = sites.sources.names.email_intake;
const SOURCES = "/admin/parametres?tab=sources";
const SHEET = "/admin/parametres?tab=sources&fournisseur=brevo-inbound";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(() => database.end());

function deliver(request: APIRequestContext, body: unknown, options: { secret?: string | null; ip?: string } = {}) {
  const { secret = SECRET, ip = BREVO_IP } = options;
  return request.post("/api/email-intake/inbound", {
    headers: { "x-forwarded-for": ip, ...(secret === null ? {} : { "x-inbound-secret": secret }) },
    data: body,
  });
}

async function switchOn(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const on = await page.request.put("/api/account/email-intake", { headers: { origin } });
  expect(on.status()).toBe(200);
  return (await on.json()).address as string;
}

async function receivedEmails(page: Page): Promise<{ id: string; outcome: string; senderDomain: string; receivedAt: string }[]> {
  const exported = await (await page.request.get("/api/account/export")).json();
  return exported.emailIntake.receivedOfferEmails;
}

async function storedText(id: string): Promise<{ ciphertext: Buffer | null }> {
  const { rows } = await database.query<{ ciphertext: Buffer | null }>("SELECT text_ciphertext AS ciphertext FROM received_offer_email WHERE id = $1", [id]);
  return rows[0]!;
}

async function queued(id: string): Promise<number> {
  const { rows } = await database.query<{ n: number }>("SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'receivedOfferEmailId' = $2", [READ_QUEUE, id]);
  return rows[0]!.n;
}

function runPurge(hours: number) {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "email-intake.purge", String(hours)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, MAIL_TRANSPORT: "console" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
}

test.describe("Email intake: Brevo's inbound webhook", () => {
  test("an email from a recognised sender is stored encrypted and queued for the worker", async ({ page }) => {
    const address = await switchOn(page, "inbound-recognised");
    const email = alertEmail(address);
    const response = await deliver(page.request, inboundPayload(email));
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: 1 });

    const [row, ...others] = await receivedEmails(page);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ outcome: "awaiting_reading", senderDomain: "alertes.cadremploi.fr" });
    const { ciphertext } = await storedText(row!.id);
    expect(ciphertext?.length).toBeGreaterThan(0);
    expect(ciphertext!.toString("utf8")).not.toContain("Chef de projet");
    expect(await queued(row!.id)).toBe(1);

    // Brevo delivering the same email again changes nothing.
    expect((await deliver(page.request, inboundPayload(email))).status()).toBe(200);
    expect(await receivedEmails(page)).toHaveLength(1);
    expect(await queued(row!.id)).toBe(1);
  });

  test("an email from an unknown sender leaves a row « expéditeur non reconnu » and keeps no text", async ({ page }) => {
    const address = await switchOn(page, "inbound-unknown");
    expect((await deliver(page.request, inboundPayload(unknownSenderEmail(address)))).status()).toBe(200);

    const [row, ...others] = await receivedEmails(page);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ outcome: "unrecognised_sender", senderDomain: "cabinet-fictif.test" });
    expect((await storedText(row!.id)).ciphertext).toBeNull();
    expect(await queued(row!.id)).toBe(0);
    // Nothing of the sender's message is kept anywhere in the row.
    const { rows } = await database.query("SELECT * FROM received_offer_email WHERE id = $1", [row!.id]);
    expect(JSON.stringify(rows[0])).not.toMatch(/Claire|Directeur de projet|06 00 00 00 00|claire\.exemple/);
  });

  test("a delivery without the shared secret, or with a wrong one, is refused with 401 and keeps nothing", async ({ page }) => {
    const address = await switchOn(page, "inbound-secret");
    const body = inboundPayload(alertEmail(address));
    expect((await deliver(page.request, body, { secret: "not-the-secret" })).status()).toBe(401);
    expect((await deliver(page.request, body, { secret: null })).status()).toBe(401);
    expect((await deliver(page.request, body, { secret: "" })).status()).toBe(401);
    expect(await receivedEmails(page)).toEqual([]);

    // The secret also travels as a bearer token.
    const bearer = await page.request.post("/api/email-intake/inbound", { headers: { authorization: `Bearer ${SECRET}`, "x-forwarded-for": BREVO_IP }, data: body });
    expect(bearer.status()).toBe(200);
    expect(await receivedEmails(page)).toHaveLength(1);
  });

  test("a delivery from outside Brevo's IP ranges is refused with 403, and a body that is not Brevo's with 400", async ({ page }) => {
    const address = await switchOn(page, "inbound-ip");
    expect((await deliver(page.request, inboundPayload(alertEmail(address)), { ip: OTHER_IP })).status()).toBe(403);
    expect((await deliver(page.request, { nothing: "here" })).status()).toBe(400);
    expect(await receivedEmails(page)).toEqual([]);
  });

  test("an email to an address that is no longer in use is discarded unread", async ({ page }) => {
    const first = await switchOn(page, "inbound-replaced");
    expect((await page.request.post("/api/account/email-intake/replace", { headers: { origin } })).status()).toBe(200);
    const response = await deliver(page.request, inboundPayload(alertEmail(first)));
    expect(response.status()).toBe(200);
    expect(await receivedEmails(page)).toEqual([]);
  });

  test("past the daily cap nothing more is read or queued: a row « plafond atteint », no text", async ({ page }) => {
    const address = await switchOn(page, "inbound-cap");
    const cap = 50; // EMAIL_INTAKE_DAILY_CAP's default
    const emails: BrevoInboundItem[] = Array.from({ length: cap + 2 }, (_, i) => alertEmail(address, { messageId: `<cap-${i}@mail.example.test>` }));
    expect((await deliver(page.request, inboundPayload(...emails))).status()).toBe(200);

    const rows = await receivedEmails(page);
    expect(rows).toHaveLength(cap + 2);
    const read = rows.filter((row) => row.outcome === "awaiting_reading");
    const over = rows.filter((row) => row.outcome === "over_daily_cap");
    expect(read).toHaveLength(cap);
    expect(over).toHaveLength(2);
    for (const row of over) {
      expect((await storedText(row.id)).ciphertext).toBeNull();
      expect(await queued(row.id)).toBe(0);
    }
    const { rows: jobs } = await database.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'receivedOfferEmailId' = ANY($2)",
      [READ_QUEUE, rows.map((row) => row.id)],
    );
    expect(jobs[0]!.n).toBe(cap);

    // Another delivery, still the same day: still nothing read.
    await deliver(page.request, inboundPayload(alertEmail(address, { messageId: "<cap-later@mail.example.test>" })));
    const after = await receivedEmails(page);
    expect(after.filter((row) => row.outcome === "awaiting_reading")).toHaveLength(cap);
    expect(after).toHaveLength(cap + 3);
  });

  test("the worker purges a text 72 hours after it arrived, and the email 12 months after (clock set ahead)", async ({ page }) => {
    const address = await switchOn(page, "inbound-purge");
    expect((await deliver(page.request, inboundPayload(alertEmail(address)))).status()).toBe(200);
    const [row] = await receivedEmails(page);
    expect((await storedText(row!.id)).ciphertext).not.toBeNull();

    runPurge(71);
    expect((await storedText(row!.id)).ciphertext).not.toBeNull();

    runPurge(73);
    expect((await storedText(row!.id)).ciphertext).toBeNull();
    // The row itself stays (outcome, domain, dates) until 12 months.
    expect((await receivedEmails(page)).map((r) => r.id)).toEqual([row!.id]);

    runPurge(13 * 31 * 24);
    expect(await receivedEmails(page)).toEqual([]);
  });

  test.describe("in the Back Office (#448)", () => {
    const sender = `alertes-${Date.now().toString(36)}.monster-e2e.test`;
    const sourceRow = (page: Page) => page.locator('tr[data-source="email_intake"]');
    const senderRow = (page: Page) => page.locator(`tr[data-sender="${sender}"]`);

    test.afterAll(async () => {
      await database.query("DELETE FROM recognised_sender WHERE value = $1", [sender]);
      await database.query("UPDATE job_discovery_source SET enabled = true WHERE source = 'email_intake'");
    });

    async function personPage(browser: Browser, email: string): Promise<Page> {
      const context = await browser.newContext({ baseURL: origin });
      const page = await context.newPage();
      await signInWithMagicLink(page, email);
      return page;
    }

    test("a super-admin switches Email intake off and on (audited), adds and labels a Recognised sender; Support reads, changes nothing", async ({ page, browser }) => {
      // Switched off on the Sources tab: an email reaching a Forwarding address is discarded unread.
      const candidate = await personPage(browser, newAddress("inbound-switched-off"));
      const on = await candidate.request.put("/api/account/email-intake", { headers: { origin } });
      const address = (await on.json()).address as string;
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(SOURCES);
      await expect(sourceRow(page).getByRole("cell").first()).toHaveText(sites.enabled);
      await sourceRow(page).getByRole("button", { name: tr(sites.disable, { name: SOURCE_NAME }), exact: true }).click();
      await expect(sourceRow(page).getByRole("cell").first()).toHaveText(sites.disabled);
      expect((await deliver(candidate.request, inboundPayload(alertEmail(address)))).status()).toBe(200);
      expect(await receivedEmails(candidate)).toEqual([]);

      // Switched on again: the next one is received.
      await sourceRow(page).getByRole("button", { name: tr(sites.enable, { name: SOURCE_NAME }), exact: true }).click();
      await expect(sourceRow(page).getByRole("cell").first()).toHaveText(sites.enabled);
      expect((await deliver(candidate.request, inboundPayload(alertEmail(address)))).status()).toBe(200);
      expect(await receivedEmails(candidate)).toHaveLength(1);

      await page.goto("/admin/journal?section=job_discovery_sources");
      const switched = page.getByRole("row").filter({ hasText: SUPER_ADMIN }).filter({ hasText: SOURCE_NAME });
      await expect(switched.nth(0)).toContainText(tr(journal.changed, { field: sites.status, before: sites.disabled, after: sites.enabled }));
      await expect(switched.nth(1)).toContainText(tr(journal.changed, { field: sites.status, before: sites.enabled, after: sites.disabled }));

      // The Email intake sheet, opened from the source's provider: its settings, its key, its Recognised senders.
      await page.goto(SOURCES);
      await sourceRow(page).getByRole("link", { name: "Brevo (Inbound Parsing)" }).click();
      await expect(page).toHaveURL(SHEET);
      const sheet = page.locator('aside[data-sheet="brevo-inbound"]');
      await expect(sheet.locator('tr[data-setting="EMAIL_INTAKE_DOMAIN"]')).toBeVisible();
      await expect(sheet.locator('[data-key="BREVO_INBOUND_SECRET"]')).toBeVisible();
      await expect(sheet.locator('tr[data-sender="cadremploi.fr"]')).toContainText("Cadremploi – cadremploi.fr");

      await sheet.getByLabel(senders.senderField).fill(sender.toUpperCase());
      await sheet.getByLabel(senders.labelField, { exact: true }).fill("Monster – monster.fr");
      await sheet.getByRole("button", { name: senders.add }).click();
      await expect(page.getByRole("status").filter({ hasText: admin.emailIntake.notices.added })).toBeVisible();
      await expect(senderRow(page)).toContainText("Monster – monster.fr");
      await expect(senderRow(page)).toContainText(sites.enabled);

      await senderRow(page).getByText(tr(senders.relabel, { sender })).click();
      await senderRow(page).getByLabel(tr(senders.newLabel, { sender })).fill("Monster – www.monster.fr");
      await senderRow(page).getByRole("button", { name: tr(senders.saveLabel, { sender }) }).click();
      await expect(senderRow(page).getByRole("cell").first()).toHaveText("Monster – www.monster.fr");
      const stored = await database.query("SELECT label, enabled FROM recognised_sender WHERE value = $1", [sender]);
      expect(stored.rows).toEqual([{ label: "Monster – www.monster.fr", enabled: true }]);

      await page.goto("/admin/journal?section=recognised_senders");
      const recorded = page.getByRole("row").filter({ hasText: sender });
      await expect(recorded).toHaveCount(2);
      await expect(recorded.nth(0)).toContainText(tr(journal.changed, { field: senders.label, before: "Monster – monster.fr", after: "Monster – www.monster.fr" }));
      await expect(recorded.nth(1)).toContainText(journal.actions.added);
      for (const row of await recorded.all()) await expect(row).toContainText(SUPER_ADMIN);

      // Support reads the source and the sheet, and has no way to change them.
      const support = newAddress("inbound-support");
      const supportPage = await personPage(browser, support);
      await page.goto("/admin/administrateurs");
      await page.getByLabel(admin.administrators.grantEmail).fill(support);
      await page.getByRole("checkbox", { name: admin.roles.support }).check();
      await page.getByRole("button", { name: admin.administrators.grant }).click();
      await expect(page.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles.support }));

      await supportPage.goto(SOURCES);
      await expect(sourceRow(supportPage).getByRole("button", { name: tr(sites.disable, { name: SOURCE_NAME }), exact: true })).toBeDisabled();
      await supportPage.goto(SHEET);
      await expect(senderRow(supportPage)).toContainText("Monster – www.monster.fr");
      await expect(senderRow(supportPage).getByRole("button", { name: tr(senders.disable, { sender }) })).toBeDisabled();
      await expect(senderRow(supportPage).getByRole("button", { name: tr(senders.remove, { sender }) })).toBeDisabled();
      await expect(senderRow(supportPage).getByText(tr(senders.relabel, { sender }))).toHaveCount(0);
      await expect(supportPage.getByRole("button", { name: senders.add })).toBeDisabled();
      await expect(supportPage.locator('aside[data-sheet="brevo-inbound"] form')).toHaveCount(0);
      expect((await database.query("SELECT label, enabled FROM recognised_sender WHERE value = $1", [sender])).rows).toEqual([{ label: "Monster – www.monster.fr", enabled: true }]);
    });
  });
});
