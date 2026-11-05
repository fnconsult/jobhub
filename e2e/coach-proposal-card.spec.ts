import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "./support/axe";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #715 (ADR-0077): a Coach proposal in the thread. A Coach Action that proposes makes an Action Card under the
// reply, after its Provenance line: « Appliquer » changes the object through its domain module, « Annuler » puts the state
// before back, « Modifier avant d'appliquer » opens the page's form pre-filled in the Work Pane, and the object keeps its
// Origin, which « Origine » reveals. No Coach Action is shipped yet (#716 on), so this spec runs on a server of its own with
// COACH_ACTIONS_ENABLED on and the suite's fake Coach Action (E2E_FAKE_COACH_ACTIONS: an Application Status, proposed and
// applied through the Applications module). The AI Coach is faked inside it (fake-mistral.mjs): a message holding
// `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action.
// Issue #717: « Propositions du coach : Formulaire » in Mon compte opens the proposal's form by itself in the Work Pane.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
const display = fr.coachProposalsDisplay;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 715;
const TITLE = "Responsable logistique (H/F)";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Responsable logistique",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Responsable logistique", employer: "Carrefour Supply", location: "Lyon", period: "2010 – 2024", description: "Pilotage des entrepôts." }],
  education: [],
  skills: ["Supply chain", "WMS"],
  languages: [],
};

let server: OwnServer;

async function statusOf(id: string): Promise<{ status: string; status_origin: { origin: string; cardId: string } | null }> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query("SELECT status, status_origin FROM application WHERE id = $1", [id])).rows[0];
  } finally {
    await db.end();
  }
}

/** A new Candidate, signed in on a wide screen, with an Application « À postuler »: its page and id. */
async function withApplication(browser: Browser): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "en-US", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-proposal"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Logistique", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Pilotage de deux entrepôts.", employer: "Acme Industrie", location: "Lyon" },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { page, id: (await saved.json()).id as string };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const ficheOf = (page: Page) => page.getByRole("complementary", { name: fr.fiche.label });
const statusSelect = (page: Page) => ficheOf(page).getByRole("combobox", { name: fr.application.statusLabel, exact: true });
const cardOf = (page: Page) => conversation(page).getByRole("article", { name: new RegExp(texts.fields.applicationStatus) });

/** Asks the AI Coach, on the Application's page, to propose `status` for it through the fake Coach Action. */
async function askForStatus(page: Page, id: string, status: string) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`Quel statut pour cette candidature ?\nE2E_COACH_TOOL=e2e_proposer_statut:${JSON.stringify({ id, status })}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  await expect(cardOf(page)).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("a Coach proposal in the thread: « Appliquer », « Annuler », « Origine » (#715)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_proposal_card", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-proposal-card-e2e-coach-proposal-card-e2e",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      COACH_ACTIONS_ENABLED: "true",
      E2E_FAKE_COACH_ACTIONS: "1",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("after a long message, the reply and its Action Card arrive whole in view, under the Top Bar, above the box (#786)", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/candidatures/${id}`);
    const pasted = Array.from({ length: 24 }, (_, i) => `Ligne collée ${i + 1} de l'offre.`).join("\n");
    await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${pasted}\nE2E_COACH_TOOL=e2e_proposer_statut:${JSON.stringify({ id, status: "interview" })}`);
    await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(cardOf(page)).toBeVisible({ timeout: 30_000 });

    await expect(async () => {
      const bar = (await page.getByRole("banner").boundingBox())!;
      const foot = (await conversation(page).locator(".page-conversation-foot").boundingBox())!;
      for (const part of [messages(page).last(), cardOf(page)]) {
        const shown = (await part.boundingBox())!;
        expect(shown.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
        expect(shown.y + shown.height).toBeLessThanOrEqual(foot.y + 1);
      }
    }).toPass({ timeout: 5_000 });
  });

  test("proposal → « Appliquer » → the status changed, « Origine » says so → « Annuler » → the status before", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);
    await expect(statusSelect(page)).toHaveValue("to_apply");

    await askForStatus(page, id, "interview");

    // Under the reply, after its Provenance line: who proposed it, what changes on which object, before → after.
    const reply = messages(page).last();
    await expect(reply.locator(".provenance-line")).toBeVisible();
    const card = cardOf(page);
    await expect(reply.getByRole("article")).toHaveCount(1);
    await expect(card).toContainText(texts.by);
    await expect(card.getByRole("link", { name: `${TITLE} · Acme Industrie` })).toHaveAttribute("href", `/candidatures/${id}`);
    await expect(card).toContainText(fr.applicationStatuses.to_apply);
    await expect(card).toContainText(fr.applicationStatuses.interview);
    await expect(card.getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);
    // Proposed, nothing changed yet.
    expect((await statusOf(id)).status).toBe("to_apply");
    expect((await new AxeBuilder({ page }).include(".coach-proposal-card").analyze()).violations).toEqual([]);

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`));
    await expect(statusSelect(page)).toHaveValue("interview");
    expect(await statusOf(id)).toMatchObject({ status: "interview", status_origin: { origin: "coach_proposal", cardId: expect.any(String) } });

    // The Origin, hidden until « Origine » is opened.
    const origin = ficheOf(page).locator("details.origin-disclosure");
    await expect(origin.getByText(/Sur proposition de votre coach IA/)).toBeHidden();
    await origin.getByText(fr.origin.label, { exact: true }).click();
    await expect(origin).toContainText(new RegExp(`${tr(fr.origin.coachProposal, { date: ".+" })}`));

    await card.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.undone, { time: "\\d\\d:\\d\\d" })}$`));
    await expect(statusSelect(page)).toHaveValue("to_apply");
    await expect(ficheOf(page).locator("details.origin-disclosure")).toHaveCount(0);
    expect(await statusOf(id)).toMatchObject({ status: "to_apply", status_origin: null });
    await expect(card.getByRole("button")).toHaveCount(0);

    // Reopened, the thread shows the card as it was left.
    await page.reload();
    await expect(cardOf(page).getByRole("status")).toHaveText(new RegExp(`^${tr(texts.undone, { time: "\\d\\d:\\d\\d" })}$`));
  });

  test("« Modifier avant d'appliquer »: the page's form pre-filled in the Work Pane, kept when it closes, applied as edited", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);
    await askForStatus(page, id, "interview");

    await cardOf(page).getByRole("button", { name: texts.edit, exact: true }).click();
    const pane = page.getByRole("complementary", { name: tr(texts.editTitle, { what: texts.fields.applicationStatus }) });
    await expect(pane.getByRole("heading", { level: 2 })).toBeFocused();
    const field = pane.getByRole("combobox", { name: texts.fields.applicationStatus });
    await expect(field).toHaveValue("interview");
    await field.selectOption("offer_received");
    await pane.getByRole("button", { name: fr.conversationFirst.close, exact: true }).click();
    await expect(pane).toBeHidden();

    await cardOf(page).getByRole("button", { name: texts.edit, exact: true }).click();
    await expect(pane.getByRole("combobox", { name: texts.fields.applicationStatus })).toHaveValue("offer_received");
    await pane.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(pane).toBeHidden();
    await expect(cardOf(page).getByRole("status")).toHaveText(new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`));
    await expect(statusSelect(page)).toHaveValue("offer_received");
    expect((await statusOf(id)).status).toBe("offer_received");
  });

  test("« Propositions du coach : Formulaire » in Mon compte → a proposal → the Work Pane opens by itself on its form (#717)", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto("/compte/preferences");
    const choice = page.getByRole("radiogroup", { name: display.label });
    await expect(choice.getByRole("radio", { name: display.card, exact: true })).toHaveAttribute("aria-checked", "true");

    await choice.getByRole("radio", { name: display.form, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: display.saved.form })).toBeVisible();
    // Kept with the account, and in its Data export.
    await page.reload();
    await expect(choice.getByRole("radio", { name: display.form, exact: true })).toHaveAttribute("aria-checked", "true");
    const exported = await page.request.get("/api/account/export");
    expect(exported.ok()).toBe(true);
    expect((await exported.json()).coachProposalsDisplay).toMatchObject({ display: "form", chosenAt: expect.any(String) });

    await page.goto(`/candidatures/${id}`);
    await askForStatus(page, id, "interview");

    const pane = page.getByRole("complementary", { name: tr(texts.editTitle, { what: texts.fields.applicationStatus }) });
    await expect(pane).toBeVisible();
    await expect(pane.getByRole("combobox", { name: texts.fields.applicationStatus })).toHaveValue("interview");
    // The card keeps both buttons; nothing is applied until the Candidate applies it.
    await expect(cardOf(page).getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);
    expect((await statusOf(id)).status).toBe("to_apply");

    await pane.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(pane).toBeHidden();
    await expect(statusSelect(page)).toHaveValue("interview");
  });

  test("the object changed since the proposal: « Appliquer » is refused as a conflict, never merged, the card still waits", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);
    await askForStatus(page, id, "interview");

    await statusSelect(page).selectOption("applied"); // on its page, meanwhile
    await expect.poll(async () => (await statusOf(id)).status).toBe("applied");
    await cardOf(page).getByRole("button", { name: texts.apply, exact: true }).click();

    await expect(cardOf(page).getByRole("alert")).toHaveText(texts.problems.conflict);
    await expect(cardOf(page).getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);
    expect(await statusOf(id)).toMatchObject({ status: "applied", status_origin: null });
  });
});
