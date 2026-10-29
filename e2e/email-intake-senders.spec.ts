import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { alertEmail, inboundPayload } from "../apps/web/src/email-intake/fixtures/brevo-inbound";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #450: a Candidate recognises a sender for themselves alone, from an « expéditeur non reconnu » row (one click)
// or by pasting its sending address on « Réception par email »; it counts from their next email, and still not for
// another Candidate. Each addition is proposed to Administrators (domain and number of Candidates, no names); accepting
// one adds it to the platform's list, for all. Emails are delivered over HTTP as Brevo would (fictional payloads); in
// the worker project because the emails it delivers are queued for reading, and no worker must read them meanwhile.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const recognised = fr.emailIntake.recognised;
const proposed = fr.admin.emailIntake.proposed;
const origin = process.env.E2E_WEB_ORIGIN!;
const SECRET = "e2e-brevo-inbound-secret";
const BREVO_IP = "203.0.113.7"; // inside EMAIL_INTAKE_BREVO_IP_RANGES (playwright.config.ts)
const SUPER_ADMIN = "email-intake-office@e2e.jobbbox.test";
const SHEET = "/admin/parametres?tab=sources&fournisseur=brevo-inbound";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Bianca Castafiore",
  headline: "Directrice marketing",
  email: "bianca.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Quinze ans de marketing dans l'industrie.",
  experience: [{ title: "Directrice marketing", employer: "Moulinsart Industries", location: "Lyon", period: "2009 – 2024", description: "Marketing du groupe." }],
  education: [],
  skills: ["Marketing"],
  languages: [],
};

function deliver(request: APIRequestContext, to: string, from: string, messageId: string) {
  return request.post("/api/email-intake/inbound", {
    headers: { "x-forwarded-for": BREVO_IP, "x-inbound-secret": SECRET },
    data: inboundPayload(alertEmail(to, { from, messageId })),
  });
}

/** A Candidate signed in on a page of their own, with Email intake switched on: their Forwarding address. */
async function candidate(browser: Browser, label: string): Promise<{ page: Page; address: string }> {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  await signInWithMagicLink(page, newAddress(label));
  const on = await page.request.put("/api/account/email-intake", { headers: { origin } });
  expect(on.status()).toBe(200);
  return { page, address: (await on.json()).address as string };
}

/** The outcomes of the Candidate's Received offer emails, newest first, from their Data export. */
async function outcomes(page: Page): Promise<string[]> {
  const exported = await (await page.request.get("/api/account/export")).json();
  return exported.emailIntake.receivedOfferEmails.map((email: { outcome: string }) => email.outcome);
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("Email intake: Recognised senders a Candidate adds (#450)", () => {
  test("after adding a sender from its ignored row, its next email is read for that Candidate and still discarded for another; axe passes", async ({ browser }) => {
    const sender = `alertes@mail.monster-${tag}.example`;
    const domain = `mail.monster-${tag}.example`;
    const marie = await candidate(browser, "senders-marie");
    const paul = await candidate(browser, "senders-paul");
    const created = await marie.page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice marketing", locations: ["Lyon"], contractTypes: ["cdi"] } } });
    expect(created.status(), await created.text()).toBe(201);
    const profile = (await created.json()).id as string;

    expect((await deliver(marie.page.request, marie.address, sender, `<first-${tag}@monster.example>`)).status()).toBe(200);
    expect(await outcomes(marie.page)).toEqual(["unrecognised_sender"]);

    await marie.page.goto(`/recherches?profil=${profile}`);
    const row = marie.page.getByRole("list", { name: fr.receivedByEmail.ignored.listLabel }).getByRole("listitem").filter({ hasText: domain });
    await row.getByRole("button", { name: tr(fr.receivedByEmail.ignored.recogniseLabel, { domain }) }).click();
    await expect(row.getByRole("status")).toHaveText(fr.receivedByEmail.ignored.recognised);
    await expectAccessible(marie.page);
    // Once added, the row no longer offers it.
    await marie.page.reload();
    await expect(row.getByRole("status")).toHaveText(fr.receivedByEmail.ignored.recognisedAlready);
    await expect(row.getByRole("button")).toHaveCount(0);

    expect((await deliver(marie.page.request, marie.address, sender, `<next-${tag}@monster.example>`)).status()).toBe(200);
    expect((await deliver(paul.page.request, paul.address, sender, `<paul-${tag}@monster.example>`)).status()).toBe(200);

    // The email already ignored is not recovered.
    expect(await outcomes(marie.page)).toEqual(["awaiting_reading", "unrecognised_sender"]);
    expect(await outcomes(paul.page)).toEqual(["unrecognised_sender"]);
  });

  test("on « Réception par email », the Candidate pastes a sending address, removes it, and switches a platform sender off for themselves alone; axe passes", async ({ browser }) => {
    const marie = await candidate(browser, "senders-account");
    const paul = await candidate(browser, "senders-account-paul");
    const page = marie.page;
    await page.goto("/compte/reception-email");
    const section = page.getByRole("region", { name: recognised.title });
    await expect(section.getByText(recognised.fromHint)).toBeVisible();

    // A shared sending platform's domain alone is not enough: its full address is kept.
    await section.getByLabel(recognised.senderLabel).fill("noreply5.jobs2web.com");
    await section.getByRole("button", { name: recognised.add, exact: true }).click();
    await expect(section.getByRole("alert")).toHaveText(recognised.errors.address_needed);
    await section.getByLabel(recognised.senderLabel).fill("Thales-JobNotification@noreply5.jobs2web.com");
    await section.getByLabel(recognised.labelLabel).fill("Thales");
    await section.getByRole("button", { name: recognised.add, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(recognised.added);
    const own = section.getByRole("list", { name: recognised.ownListLabel }).getByRole("listitem");
    await expect(own).toHaveCount(1);
    await expect(own).toContainText("Thales (thales-jobnotification@noreply5.jobs2web.com)");
    await expectAccessible(page);

    await page.reload();
    await section.getByRole("button", { name: tr(recognised.removeLabel, { value: "thales-jobnotification@noreply5.jobs2web.com" }) }).click();
    await expect(section.getByText(recognised.ownNone)).toBeVisible();

    const cadremploi = section.getByRole("list", { name: recognised.platformListLabel }).getByRole("listitem").filter({ hasText: "Cadremploi – cadremploi.fr" });
    await cadremploi.getByRole("button", { name: tr(recognised.switchOffLabel, { label: "Cadremploi – cadremploi.fr" }) }).click();
    await expect(cadremploi).toContainText(recognised.switchedOff);

    expect((await deliver(page.request, marie.address, "offres@alertes.cadremploi.fr", `<cadremploi-${tag}@cadremploi.fr>`)).status()).toBe(200);
    expect((await deliver(paul.page.request, paul.address, "offres@alertes.cadremploi.fr", `<cadremploi-paul-${tag}@cadremploi.fr>`)).status()).toBe(200);
    expect(await outcomes(page)).toEqual(["unrecognised_sender"]);
    expect(await outcomes(paul.page)).toEqual(["awaiting_reading"]);
    await expectAccessible(page);
  });

  test("the proposal shows a count and no Candidate; accepting it makes it recognised for all", async ({ browser, page }) => {
    const domain = `alertes.hellojob-${tag}.example`;
    const marie = await candidate(browser, "senders-propose-marie");
    const jean = await candidate(browser, "senders-propose-jean");
    const paul = await candidate(browser, "senders-propose-paul");
    for (const [who, label] of [[marie, "Les alertes de Marie"], [jean, "Les alertes de Jean"]] as const) {
      const added = await who.page.request.post("/api/account/email-intake/recognised-senders", { headers: { origin }, data: { sender: `offres@${domain}`, label } });
      expect(added.status(), await added.text()).toBe(200);
    }

    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(SHEET);
    const proposal = page.locator(`tr[data-proposed="${domain}"]`);
    await expect(proposal.getByRole("cell").first()).toHaveText("2");
    const section = page.locator('[data-section="proposed-senders"]');
    await expect(section.getByText(/Marie|Jean|senders-propose/)).toHaveCount(0);

    await proposal.getByLabel(tr(proposed.labelFor, { sender: domain })).fill("HelloJob – hellojob.example");
    await proposal.getByRole("button", { name: tr(proposed.accept, { sender: domain }) }).click();
    await expect(page.locator(`tr[data-proposed="${domain}"]`)).toHaveCount(0);

    expect((await deliver(paul.page.request, paul.address, `offres@${domain}`, `<accepted-${tag}@hellojob.example>`)).status()).toBe(200);
    expect(await outcomes(paul.page)).toEqual(["awaiting_reading"]);
  });
});
