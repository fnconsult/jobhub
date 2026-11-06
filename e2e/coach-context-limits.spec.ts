import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { earliestEffectiveOn } from "../apps/web/src/quota-reductions/reduction";
import { signInWithMagicLink } from "./support/candidate";
import { emailsIn, newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Issue #731 (ADR-0078): the Coach context limits of a Plan, from the Quotas page of the Back Office to the AI Coach.
// Runs in the « plan-coach-context » project, after the web specs and the Quota Reductions' (playwright.config.ts): it
// changes Free's limits for real for a few seconds, and Standard's reduction is scheduled and cancelled. Driven through
// public doors only: the Back Office pages, POST /api/coach, GET /api/coach/conversations/[id], the Candidate's data
// export. The AI Coach is faked inside the server (fake-mistral.mjs): it says how many messages it was sent, and prints
// the system prompt it was sent on demand; every call reports 100 input tokens.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const ADMINISTRATOR = "coach-limits-office@e2e.jobbbox.test";
const MESSAGES_LABEL = fr.admin.planQuotas.coachContext.messages as string;
const TOKENS_LABEL = fr.admin.planQuotas.coachContext.tokens as string;
const reductions = fr.admin.quotaReductions;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const estimate = (text: string) => Math.ceil(text.length / 4);

type Limits = { coachContextMessages: number | null; coachContextTokens: number | null };
type Context = { messages: number; tokens: number; limits: Limits; split: Record<string, number> | null; upgrade?: { plan: string; name: { fr: string; en: string } } | null };

/** Saves the Free Plan's two Coach context limits on the Quotas page; "" is unlimited. */
async function setFreeLimits(admin: Page, messages: string, tokens: string) {
  await admin.goto("/admin/quotas");
  const free = admin.locator("form").filter({ has: admin.getByRole("heading", { name: "Offre Gratuite" }) });
  await free.getByLabel(MESSAGES_LABEL).fill(messages);
  await free.getByLabel(TOKENS_LABEL).fill(tokens);
  await free.getByRole("button", { name: "Enregistrer l'offre Gratuite" }).click();
  await expect(admin.getByRole("status")).toHaveText("Quotas de l'offre Gratuite enregistrés.");
}

/** Sends a message to the AI Coach; the reply and the conversation's Context bar figures. */
async function ask(page: Page, message: string, extra: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message, ...extra } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { conversation: { id: string }; reply: string; context: Context };
}

/** How many messages the (faked) AI Coach says it was sent: « (3 messages) ». */
const messagesRead = (reply: string) => Number(/\((\d+) messages?\)/.exec(reply)![1]);

/** A conversation of `count` exchanges; the last reply. */
async function exchanges(page: Page, count: number) {
  let conversationId: string | undefined;
  let last!: Awaited<ReturnType<typeof ask>>;
  for (let n = 1; n <= count; n += 1) {
    last = await ask(page, `Question ${n}`, conversationId ? { conversationId } : {});
    conversationId = last.conversation.id;
  }
  return last;
}

async function captureOffer(page: Page, title: string, content: string): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title, content: `${content} (${unique()})`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS"], requiredExperienceYears: 10 },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

/** The system prompt (the AI Coach's whole context) sent with a message about the Job Offer in view. */
async function systemPromptAbout(page: Page, jobOfferId: string): Promise<string> {
  const show = showSystemPrompt();
  await ask(page, `Bonjour ${show}`, { focus: { kind: "job_offer", id: jobOfferId } });
  return systemPromptShown(show);
}

async function adminPage(browser: import("@playwright/test").Browser, baseURL: string | undefined): Promise<Page> {
  const admin = await (await browser.newContext({ baseURL })).newPage();
  await signInWithMagicLink(admin, ADMINISTRATOR);
  return admin;
}

test.describe.configure({ mode: "serial" });

test.describe("Coach context limits of a Plan (#731)", () => {
  test("a Plan with none stored reads 40 messages and 12 000 jetons: the Quotas page, the API and the data export say so", async ({ page, browser, baseURL }) => {
    await signInWithMagicLink(page, newAddress("ctx-limits-default"));
    const admin = await adminPage(browser, baseURL);
    await admin.goto("/admin/quotas");
    const free = admin.locator("form").filter({ has: admin.getByRole("heading", { name: "Offre Gratuite" }) });
    await expect(free.getByLabel(MESSAGES_LABEL)).toHaveValue("40");
    await expect(free.getByLabel(TOKENS_LABEL)).toHaveValue("12000");
    await admin.close();

    const reply = await exchanges(page, 45);
    // 45 exchanges are 89 messages with the last one: the AI Coach read the latest 40, less the leading reply that would
    // start what it reads (a conversation it reads starts with the Candidate's message): 39.
    expect(messagesRead(reply.reply)).toBe(39);
    expect(reply.context.limits).toEqual({ coachContextMessages: 40, coachContextTokens: 12_000 });

    const conversation = await (await page.request.get(`/api/coach/conversations/${reply.conversation.id}`)).json();
    expect(conversation.conversation.context.limits).toEqual({ coachContextMessages: 40, coachContextTokens: 12_000 });

    const exported = await (await page.request.get("/api/account/export")).json();
    expect(exported.coachContextLimits).toEqual({ plan: "free", coachContextMessages: 40, coachContextTokens: 12_000 });
  });

  test("changing the messages limit changes what the AI Coach reads on the next message: lowered, raised, unlimited", async ({ page, browser, baseURL }) => {
    await signInWithMagicLink(page, newAddress("ctx-limits-messages"));
    const admin = await adminPage(browser, baseURL);
    try {
      let reply = await exchanges(page, 5);
      expect(messagesRead(reply.reply)).toBe(9);

      await setFreeLimits(admin, "3", "12000");
      reply = await ask(page, "Et maintenant ?", { conversationId: reply.conversation.id });
      expect(messagesRead(reply.reply)).toBe(3);
      expect(reply.context.limits).toEqual({ coachContextMessages: 3, coachContextTokens: 12_000 });
      // The conversation itself keeps every message: the limit is what the AI Coach reads, not what is kept.
      const kept = await (await page.request.get(`/api/coach/conversations/${reply.conversation.id}`)).json();
      expect(kept.conversation.messages).toHaveLength(12);
      expect(kept.conversation.context.limits.coachContextMessages).toBe(3);

      await setFreeLimits(admin, "1", "12000");
      reply = await ask(page, "Encore ?", { conversationId: reply.conversation.id });
      expect(messagesRead(reply.reply)).toBe(1);

      await setFreeLimits(admin, "9", "12000");
      reply = await ask(page, "Et si j'en lis plus ?", { conversationId: reply.conversation.id });
      expect(messagesRead(reply.reply)).toBe(9);

      await setFreeLimits(admin, "", "12000");
      reply = await ask(page, "Tout lire ?", { conversationId: reply.conversation.id });
      expect(reply.context.limits.coachContextMessages).toBeNull();
      // Every message of the conversation: 7 exchanges before this one, plus it.
      expect(messagesRead(reply.reply)).toBe(17);

      const exported = await (await page.request.get("/api/account/export")).json();
      expect(exported.coachContextLimits).toEqual({ plan: "free", coachContextMessages: null, coachContextTokens: 12_000 });
    } finally {
      await setFreeLimits(admin, "40", "12000");
      await admin.close();
    }
  });

  test("changing the jetons limit changes how much context the AI Coach is told on the next message; empty is unlimited", async ({ page, browser, baseURL }) => {
    await signInWithMagicLink(page, newAddress("ctx-limits-tokens"));
    const admin = await adminPage(browser, baseURL);
    try {
      // A posting in view of some 25k jetons on its own.
      const huge = await captureOffer(page, "Offre géante", "Mission interminable. ".repeat(4_300));

      // Default: within 12 000.
      const byDefault = estimate(await systemPromptAbout(page, huge));
      expect(byDefault).toBeLessThanOrEqual(12_000);
      expect(byDefault).toBeGreaterThan(11_000);

      await setFreeLimits(admin, "40", "6000");
      const lowered = estimate(await systemPromptAbout(page, huge));
      expect(lowered).toBeLessThanOrEqual(6_000);
      expect(lowered).toBeGreaterThan(5_000);

      await setFreeLimits(admin, "40", "20000");
      const raised = estimate(await systemPromptAbout(page, huge));
      expect(raised).toBeLessThanOrEqual(20_000);
      expect(raised).toBeGreaterThan(19_000);

      await setFreeLimits(admin, "40", "");
      const unlimited = estimate(await systemPromptAbout(page, huge));
      expect(unlimited).toBeGreaterThan(24_000);
    } finally {
      await setFreeLimits(admin, "40", "12000");
      await admin.close();
    }
  });

  test("each reply stores its estimate split by category; the Context bar and the Appels IA table show it against the provider's count", async ({ page, browser, baseURL }) => {
    const email = newAddress("ctx-limits-split");
    await signInWithMagicLink(page, email);
    const offer = await captureOffer(page, "Directrice financière", "Vos missions : piloter la clôture mensuelle.");
    const reply = await ask(page, "Que penses-tu de cette offre ?", { focus: { kind: "job_offer", id: offer } });

    const { tokens, split, limits } = reply.context;
    expect(limits).toEqual({ coachContextMessages: 40, coachContextTokens: 12_000 });
    expect(Object.keys(split ?? {}).sort()).toEqual(["advice", "instructions", "messages", "profile", "sources"]);
    expect(Object.values(split!).every((part) => Number.isInteger(part) && part >= 0)).toBe(true);
    expect(Object.values(split!).reduce((sum, part) => sum + part, 0)).toBe(tokens);
    expect(split!.instructions).toBeGreaterThan(0);
    expect(split!.profile).toBeGreaterThan(0);
    expect(split!.messages).toBeGreaterThan(0);
    // The same figures on the conversation, as the Context bar reads them.
    const read = await (await page.request.get(`/api/coach/conversations/${reply.conversation.id}`)).json();
    expect(read.conversation.context).toEqual(expect.objectContaining({ tokens, split, limits }));

    // Appels IA: that reply's estimate against the call's input_tokens (100 for the fake), with the gap.
    const admin = await adminPage(browser, baseURL);
    await admin.goto("/admin/activite/appels-ia");
    await expect(admin.getByRole("columnheader", { name: fr.admin.aiMessages.context })).toBeVisible();
    await admin.goto(`/admin/activite/appels-ia?candidate=${encodeURIComponent(email)}`);
    const row = admin.getByRole("row").filter({ hasText: email }).filter({ hasText: " / 100 (" });
    await expect(row.first()).toBeVisible();
    const figures = new Intl.NumberFormat("fr-FR");
    const gap = new Intl.NumberFormat("fr-FR", { signDisplay: "exceptZero" });
    const share = new Intl.NumberFormat("fr-FR", { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 });
    const expected = `${figures.format(tokens)} / 100 (${gap.format(100 - tokens)}, ${share.format((100 - tokens) / tokens)})`;
    await expect(row.first()).toContainText(expected.replace(/\s/g, " "), { useInnerText: true });
    await admin.close();
  });

  test("the Back Office Audit names the limits an Administrator changed", async ({ browser, baseURL }) => {
    const admin = await adminPage(browser, baseURL);
    try {
      await setFreeLimits(admin, "39", "12000");
      await admin.goto("/admin/journal?section=plan_quotas");
      const entry = admin.getByRole("row").filter({ hasText: ADMINISTRATOR }).first();
      await expect(entry).toContainText(`${MESSAGES_LABEL} : 40 → 39`);
    } finally {
      await setFreeLimits(admin, "40", "12000");
      await admin.close();
    }
  });

  test("each Candidate sees their Plan's limits on Mon abonnement, never in jetons, and from 80 % the bar names a higher Plan only when one allows more (#732)", async ({ page, browser, baseURL }) => {
    const card = (name: string) => page.locator(".plan-card").filter({ has: page.getByRole("heading", { name, level: 3 }) });
    const memory = fr.billing.coachContext.memory as string;
    const size = fr.billing.coachContext.size as string;
    await signInWithMagicLink(page, newAddress("ctx-limits-plans"));
    const admin = await adminPage(browser, baseURL);
    try {
      await setFreeLimits(admin, "4", "6000");

      // Free reads 4 messages within 6 000; Standard and Premium, none stored, 40 within 12 000: twice Free's.
      await page.goto("/abonnement");
      await expect(card("Gratuite").locator("li").filter({ hasText: memory })).toContainText("4 messages");
      await expect(card("Gratuite").locator("li").filter({ hasText: size })).toContainText("×1");
      await expect(card("Standard").locator("li").filter({ hasText: memory })).toContainText("40 messages");
      await expect(card("Standard").locator("li").filter({ hasText: size })).toContainText("×2");
      await expect(page.locator(".subscription")).not.toContainText(/jetons?|tokens?/i);

      // 4 messages of 4: nearly full, Standard is named, the next Plan up that reads more.
      let reply = await ask(page, "Question 1");
      expect(reply.context.limits).toEqual({ coachContextMessages: 4, coachContextTokens: 6_000 });
      reply = await ask(page, "Question 2", { conversationId: reply.conversation.id });
      expect(reply.context).toMatchObject({ messages: 4, upgrade: { plan: "standard", name: { fr: "Standard", en: "Standard" } } });
      const reopened = await (await page.request.get(`/api/coach/conversations/${reply.conversation.id}`)).json();
      expect(reopened.conversation.context.upgrade).toMatchObject({ plan: "standard" });
    } finally {
      await setFreeLimits(admin, "40", "12000");
      await admin.close();
    }

    // On Standard, Premium allows no more (40 within 12 000 too): nothing is named, even nearly full.
    const email = newAddress("ctx-limits-plans-standard");
    const standard = await (await browser.newContext({ baseURL })).newPage();
    await signInWithMagicLink(standard, email);
    await subscribe(standard, email, "standard");
    const last = await exchanges(standard, 16);
    expect(last.context).toMatchObject({ messages: 32, limits: { coachContextMessages: 40 }, upgrade: null });
    await standard.close();
  });

  test("lowering a limit on a paid Plan is a Quota Reduction: a notice is required, subscribers are told, and the AI Coach reads less only from its date", async ({ page, browser, baseURL }) => {
    const email = newAddress("ctx-limits-reduction");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const admin = await adminPage(browser, baseURL);
    try {
      await admin.goto("/admin/quotas");
      const standard = admin.locator("form").filter({ has: admin.getByRole("heading", { name: "Offre Standard" }) });
      const messages = standard.getByLabel(MESSAGES_LABEL);
      const before = await messages.inputValue();
      await messages.fill("5");
      // Refused without a notice.
      await standard.getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
      await expect(admin.getByRole("alert").filter({ hasText: reductions.errors.notice_required })).toBeVisible();

      await messages.fill("5");
      await standard.getByLabel(reductions.reasonLabel).fill("Le contexte du coach coûte plus cher à nos fournisseurs.");
      await standard.getByLabel(reductions.effectiveOnLabel).fill(earliestEffectiveOn(new Date()));
      await standard.getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
      await expect(admin.getByRole("status")).toContainText("Baisse de l'offre Standard programmée");

      // Nothing changed yet, for the page or the AI Coach.
      await admin.goto("/admin/quotas");
      await expect(standard.getByLabel(MESSAGES_LABEL)).toHaveValue(before);
      const reply = await exchanges(page, 4);
      expect(messagesRead(reply.reply)).toBe(7);
      expect(reply.context.limits.coachContextMessages).toBe(Number(before));

      // The subscriber is told.
      const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "quota-reductions.run", "0"], {
        env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: process.env.E2E_WEB_ORIGIN, MAIL_TRANSPORT: "console", AI_FAKE: "" },
        encoding: "utf8",
      });
      expect(run.status, run.stderr).toBe(0);
      const notices = emailsIn(run.stdout + run.stderr, email);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.text).toContain("Mémoire du coach (messages lus)");
      expect(notices[0]!.text).not.toMatch(/jetons|tokens/i);

      // Cancelled before its date: Standard keeps what it has, for the other tests.
      await admin.goto("/admin/offres#baisses");
      const row = admin.getByRole("row").filter({ hasText: "Le contexte du coach coûte plus cher à nos fournisseurs." });
      await expect(row).toContainText("Mémoire du coach (messages lus)");
      await row.getByRole("button", { name: reductions.cancel.replace("{{plan}}", "Standard") }).click();
      await expect(admin.getByRole("status")).toHaveText(reductions.cancelled);
    } finally {
      await admin.close();
    }
  });
});
