import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #788 (ADR-0077): the Coach Actions seen in the conversation. While a reply is on its way, one glyph on its left
// morphs from step to step (the toolbox while a Coach Action runs, then the brain and the feather) and each Coach Action
// has a line of its own, its label and the Tool it reads, which stays past the Guardrail's « Vérification ». Once the reply
// is there, no reply has a glyph in the margin: its words come one by one (all at once under reduced motion, and from the
// history), then « Le coach a consulté N éléments de Jobbbox », which opens on each, linked, after a reload too. This spec
// runs on a server of its own with COACH_ACTIONS_ENABLED on and the suite's fake Coach Actions (E2E_FAKE_COACH_ACTIONS: a
// slow read, e2e_lire_lentement). The AI Coach is faked inside it (fake-mistral.mjs): each `E2E_COACH_TOOL=<name>:<json>`
// of a message has it call that Coach Action, in turn; `E2E_COACH_SLOW=<ms>` delays its answer, and
// `E2E_DATA_CHECK_SLOW=<ms>` in what a read gives back delays its Guardrail check.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const steps = fr.aiActivity.steps;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 788;
/** The Job Offer's title: the slow read gives it to the AI Coach, and its check (« Vérification ») takes 1.5 s. */
const TITLE = "Contrôleuse de gestion E2E_DATA_CHECK_SLOW=1500";

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Contrôleuse de gestion",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Toulouse",
  summary: "",
  experience: [{ title: "Contrôleuse de gestion", employer: "Groupe Exemple", location: "Toulouse", period: "2012 – 2024", description: "Budget et clôtures mensuelles." }],
  education: [],
  skills: ["Contrôle de gestion", "SAP"],
  languages: [],
};

let server: OwnServer;

/** A new Candidate, signed in on a wide screen, with a Profile and an Application at Airbus, on its page. */
async function withApplication(browser: Browser, options: BrowserContextOptions = {}): Promise<{ page: Page; applicationId: string; profileId: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 }, ...options });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-tool-activity"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Contrôle de gestion", locations: ["Toulouse"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Budget, clôtures et reporting.", employer: "Airbus", location: "Toulouse" },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const profileId = (await profile.json()).id as string;
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  await page.goto(`/candidatures/${applicationId}`);
  return { page, applicationId, profileId };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
/** The thread's messages, not the lists inside them. */
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator(":scope > li");
const liveGlyph = (page: Page) => conversation(page).locator(".coach-panel-live svg.activity-glyph");
const lines = (page: Page) => conversation(page).locator(".coach-panel-step");

async function ask(page: Page, text: string) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

/** Two Coach Actions in turn: the slow read of the Application, then the read of the Profile; the answer slow too. */
const twoReads = (applicationId: string, profileId: string) =>
  `Où en est ma candidature ? E2E_COACH_TOOL=e2e_lire_lentement:${JSON.stringify({ id: applicationId, ms: 2500 })} E2E_COACH_TOOL=read_profile:${JSON.stringify({ id: profileId })} E2E_COACH_SLOW=2500`;

/** « Le coach a consulté 2 éléments de Jobbbox », opened: its two elements, linked to their pages. */
async function expectConsulted(page: Page, applicationId: string, profileId: string) {
  const reply = messages(page).last();
  const consulted = reply.locator("details.coach-tools-consulted");
  await expect(consulted.locator("summary")).toHaveText(fr.coachPanel.consulted.summary_other.replace("{{count}}", "2"));
  await consulted.locator("summary").click();
  await expect(consulted.getByRole("link")).toHaveText([fr.coachPanel.consulted.pages.application, fr.coachPanel.consulted.pages.profile]);
  await expect(consulted.getByRole("link", { name: fr.coachPanel.consulted.pages.application })).toHaveAttribute("href", `/candidatures/${applicationId}`);
  await expect(consulted.getByRole("link", { name: fr.coachPanel.consulted.pages.profile })).toHaveAttribute("href", `/profils/${profileId}`);
}

test.describe.configure({ mode: "serial" });

test.describe("the Coach Actions seen in the conversation (#788)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_tool_activity", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-tool-activity-e2e-coach-tool-activity-e2e",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_GUARDRAIL_PROVIDER: "mistral",
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

  test("live: a line per Coach Action, with what it reads, kept past « Vérification »; one glyph, act then think_write", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, applicationId, profileId } = await withApplication(browser);
    // Every set of lines shown, as the steps come: the « Vérification » after a read is quick.
    await page.evaluate(() => {
      const seen: string[][] = [];
      (window as unknown as { seenLines: string[][] }).seenLines = seen;
      new MutationObserver(() => {
        const shown = [...document.querySelectorAll(".coach-panel-step")].map((line) => line.textContent ?? "");
        if (shown.length > 0 && JSON.stringify(shown) !== JSON.stringify(seen.at(-1))) seen.push(shown);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });

    await ask(page, twoReads(applicationId, profileId));

    // The slow read under way: its line, the toolbox the one glyph of the reply on its way.
    await expect(lines(page)).toHaveText([`${steps.act} · Candidatures`], { timeout: 20_000 });
    await expect(liveGlyph(page)).toHaveCount(1);
    await expect(liveGlyph(page)).toHaveAttribute("data-activity", "act");
    await expect(lines(page).first().locator(".coach-panel-step-dot")).toBeVisible();
    const axe = await new AxeBuilder({ page }).include(".page-conversation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    // The Guardrail checks what was read: its « Vérification » after the read's line, which stays, ticked.
    await expect(lines(page)).toHaveText([`${steps.act} · Candidatures`, steps.check], { timeout: 20_000 });
    await expect(lines(page).first().locator(".coach-panel-step-done")).toBeVisible();
    await expect(liveGlyph(page)).toHaveCount(1);

    // The answer being written, last; both reads kept, ticked; the same one glyph, now think_write.
    await expect(lines(page)).toHaveText([`${steps.act} · Candidatures`, `${steps.act} · Profil`, steps.think_write], { timeout: 20_000 });
    await expect(liveGlyph(page)).toHaveCount(1);
    await expect(liveGlyph(page)).toHaveAttribute("data-activity", "think_write");
    await expect(lines(page).nth(0).locator(".coach-panel-step-done")).toBeVisible();
    // A Guardrail's « Vérification » came after the reads (each read is checked) and never took a read's line away: from
    // the slow read's line on, every set of lines shown starts with it.
    const seen = await page.evaluate(() => (window as unknown as { seenLines: string[][] }).seenLines);
    const read = seen.findIndex((shown) => shown[0] === `${steps.act} · Candidatures`);
    expect(read).toBeGreaterThanOrEqual(0);
    expect(seen.slice(read).every((shown) => shown[0] === `${steps.act} · Candidatures`)).toBe(true);
    expect(seen.slice(read)).toContainEqual(expect.arrayContaining([`${steps.act} · Candidatures`, steps.check]));

    await expect(messages(page).last()).toContainText("Résultat de l'outil", { timeout: 20_000 });
    await expect(lines(page)).toHaveCount(0);
    await page.context().close();
  });

  test("once there: no reply has a glyph in the margin; « Le coach a consulté 2 éléments de Jobbbox » opens on both, linked, after a reload too", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, applicationId, profileId } = await withApplication(browser);
    await ask(page, twoReads(applicationId, profileId));
    await expect(messages(page).last()).toContainText("Résultat de l'outil", { timeout: 30_000 });
    // Its words all there (axe reads a word still fading in as too faint).
    await expect(messages(page).last()).not.toHaveAttribute("aria-busy", /.*/, { timeout: 15_000 });

    await expect(conversation(page).locator(".chat-coach > svg.activity-glyph")).toHaveCount(0);
    await expectConsulted(page, applicationId, profileId);
    const axe = await new AxeBuilder({ page }).include(".page-conversation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);

    await page.reload();
    await expect(messages(page).last()).toContainText("Résultat de l'outil", { timeout: 20_000 });
    await expect(conversation(page).locator(".chat-coach > svg.activity-glyph")).toHaveCount(0);
    await expectConsulted(page, applicationId, profileId);
    await page.context().close();
  });

  test("the reply's words one by one (the first shown before the last); all at once under reduced motion, and from the history", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, applicationId, profileId } = await withApplication(browser);
    await ask(page, twoReads(applicationId, profileId));

    // The first word is there while the last is still coming; the reply busy meanwhile, its whole text in the page.
    await page.waitForFunction(
      () => {
        const words = [...document.querySelectorAll(".chat-revealing .coach-word")];
        return words.length > 10 && getComputedStyle(words[0]!).opacity === "1" && Number(getComputedStyle(words.at(-1)!).opacity) < 1;
      },
      undefined,
      { timeout: 30_000, polling: "raf" },
    );
    const reply = messages(page).last();
    await expect(reply).toHaveAttribute("aria-busy", "true");
    await expect(reply).toContainText("Résultat de l'outil");
    await expect(reply).not.toHaveAttribute("aria-busy", /.*/, { timeout: 10_000 });
    expect(await reply.locator(".coach-word").count()).toBe(0);

    // From the history: all at once.
    await page.reload();
    await expect(messages(page).last()).toContainText("Résultat de l'outil", { timeout: 20_000 });
    await expect(messages(page).last().locator(".coach-word")).toHaveCount(0);
    await expect(messages(page).last()).not.toHaveAttribute("aria-busy", /.*/);
    await page.context().close();

    // Less motion asked: all at once.
    const reduced = await withApplication(browser, { reducedMotion: "reduce" });
    await ask(reduced.page, "Bonjour");
    const answer = messages(reduced.page).last();
    await expect(answer).toHaveClass(/chat-coach/, { timeout: 20_000 });
    await expect(answer.locator(".coach-word")).toHaveCount(0);
    await expect(answer).not.toHaveAttribute("aria-busy", /.*/);
    await reduced.page.context().close();
  });
});
