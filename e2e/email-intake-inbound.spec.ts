import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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
});
