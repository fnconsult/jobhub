import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { activityOf, openActivity } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #720 (ADR-0077): the « Recherches d'offres » and « Job Digests » Coach Actions, end to end. On a Profile, « relance
// une recherche »: the shipped `propose_job_search` makes a card under the reply saying the Plan Quota it uses; « Lancer »
// starts the Job Search through the Job Searches module, which then shows as under way in AI Activity, with its Stop. Without
// room, the card is the Upgrade prompt in place of « Lancer », and nothing is started. A Job Digest the Plan does not send:
// the Upgrade prompt too. This spec runs on a server of its own with COACH_ACTIONS_ENABLED on and no worker (the Job Search
// stays under way); the AI Coach is faked inside it (fake-mistral.mjs): a message holding `E2E_COACH_TOOL=<name>:<json>` has
// it call that Coach Action.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 720;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const at = (template: string) => new RegExp(`^${tr(template, { time: "\\d\\d:\\d\\d" })}$`);

const masterCv = {
  fullName: "Hélène Garnier",
  headline: "Directrice financière",
  email: "helene.garnier@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Exemple", location: "Lyon", period: "2010 – 2026", description: "Clôtures et consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "Consolidation"],
  languages: [],
};

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** A new Candidate on the Free Plan (one Job Search a week, no Job Digest), signed in on a wide screen, with a Profile. */
async function withProfile(browser: Browser): Promise<{ page: Page; candidateId: string; profileId: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-job-searches"));
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"] } }, headers: { origin: server.origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const session = await (await page.request.get("/api/auth/get-session")).json();
  return { page, candidateId: session.user.id as string, profileId: (await profile.json()).id as string };
}

/** Asks the AI Coach, the Profile In view, and has it call `tool` with `args`: its reply, with its cards. */
async function ask(page: Page, profileId: string, message: string, tool: string, args: object) {
  const asked = await page.request.post("/api/coach", {
    headers: { origin: server.origin },
    data: { message: `${message}\nE2E_COACH_TOOL=${tool}:${JSON.stringify(args)}`, focus: { kind: "profile", id: profileId } },
  });
  expect(asked.status(), await asked.text()).toBe(200);
  return asked.json();
}

const jobSearchesOf = (candidateId: string) =>
  query<{ id: string; status: string; stop_requested_at: Date | null }>("SELECT id, status, stop_requested_at FROM job_search WHERE candidate_id = $1 ORDER BY started_at", [candidateId]);
const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const cardOf = (page: Page, what: string) => conversation(page).getByRole("article", { name: new RegExp(what) });

test.describe.configure({ mode: "serial" });

test.describe("the « Recherches d'offres » and « Job Digests » Coach Actions: « Lancer », AI Activity, the Upgrade prompt (#720)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_job_search_actions", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-job-search-actions-e2e-coach-job-search-act",
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
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("« relance une recherche » → a card saying the Plan Quota → « Lancer » → the Job Search under way in AI Activity, stopped from there", async ({ browser }) => {
    const { page, candidateId, profileId } = await withProfile(browser);

    const reply = await ask(page, profileId, "Relancez une recherche pour ce profil.", "propose_job_search", {});
    expect(reply.cards).toEqual([
      expect.objectContaining({ status: "pending", change: expect.objectContaining({ what: texts.fields.jobSearch, launches: true, target: expect.objectContaining({ kind: "profile", id: profileId }) }) }),
    ]);
    // Proposed, nothing started.
    expect(await jobSearchesOf(candidateId)).toEqual([]);

    await page.goto(`/conversations/${reply.conversation.id}`);
    const card = cardOf(page, texts.fields.jobSearch);
    await expect(card).toContainText(texts.by);
    await expect(card).toContainText(tr(texts.quota.jobSearch, { limit: "1", left: "0" }));
    await expect(card.getByRole("button")).toHaveText([texts.launch, texts.dismiss]);

    await card.getByRole("button", { name: texts.launch, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(at(texts.launched));
    await expect(card).toContainText(texts.launchedHint);
    await expect(card.getByRole("button")).toHaveCount(0);
    const [jobSearch] = await jobSearchesOf(candidateId);
    expect(jobSearch).toMatchObject({ status: "searching", stop_requested_at: null });

    // AI Activity: the Job Search under way, a link to its page and its stop icon.
    await page.reload();
    await openActivity(page);
    const search = activityOf(page).locator(".ai-activity-live").filter({ hasText: fr.aiActivity.kinds.job_search });
    await expect(search).toBeVisible({ timeout: 15_000 });
    await expect(search.getByRole("link", { name: fr.aiActivity.live.open.job_search })).toHaveAttribute("href", `/recherches/${jobSearch!.id}`);
    await search.getByRole("button", { name: fr.aiActivity.live.stop.job_search, exact: true }).click();
    await expect.poll(async () => (await jobSearchesOf(candidateId))[0]?.stop_requested_at).not.toBeNull();
  });

  test("without room, « relance une recherche » is a card with the Upgrade prompt in place of « Lancer »: nothing is started", async ({ browser }) => {
    const { page, candidateId, profileId } = await withProfile(browser);
    const first = await ask(page, profileId, "Lancez une recherche.", "propose_job_search", {});
    const launched = await page.request.post(`/api/action-cards/${first.cards[0].id}`, { headers: { origin: server.origin }, data: { decision: "accept" } });
    expect(launched.status(), await launched.text()).toBe(200);
    // The Free Plan's one Job Search of the week is used; it is over (the worker would have recorded it).
    await query("UPDATE job_search SET status = 'done', finished_at = now() WHERE candidate_id = $1", [candidateId]);

    const reply = await ask(page, profileId, "Relancez une recherche.", "propose_job_search", {});
    expect(reply.cards).toEqual([expect.objectContaining({ change: expect.objectContaining({ quota: expect.objectContaining({ prompt: expect.objectContaining({ upgradeTo: expect.any(String) }) }) }) })]);

    await page.goto(`/conversations/${reply.conversation.id}`);
    const card = cardOf(page, texts.fields.jobSearch).last();
    await expect(card.getByRole("alert")).toContainText(fr.billing.quotaReached.title);
    await expect(card.getByRole("button", { name: texts.launch, exact: true })).toHaveCount(0);
    expect(await jobSearchesOf(candidateId)).toHaveLength(1);
  });

  test("a Job Digest the Plan does not send: its card is the Upgrade prompt, nothing subscribed", async ({ browser }) => {
    const { page, profileId } = await withProfile(browser);

    const reply = await ask(page, profileId, "Abonnez-moi au Job Digest de ce profil chaque semaine.", "propose_job_digest_frequency", { frequency: "weekly" });
    expect(reply.cards).toEqual([
      expect.objectContaining({ change: expect.objectContaining({ what: texts.fields.jobDigest, before: texts.values.noDigest, quota: expect.objectContaining({ prompt: expect.anything() }) }) }),
    ]);
    expect(await query("SELECT 1 FROM job_digest_subscription WHERE profile_id = $1 AND unsubscribed_at IS NULL", [profileId])).toEqual([]);
  });
});

test.describe("documentation of #720", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  for (const [lang, phrase] of [["fr", "Votre coach peut vous proposer"], ["en", "Your coach can"]] as const) {
    for (const article of ["page-job-searches", "page-job-digests"]) {
      test(`Help Article ${lang}/${article} says what the coach can propose`, () => {
        expect(read(`packages/help/articles/${lang}/${article}.md`)).toContain(phrase);
      });
    }
  }
  test("the Release Note fragment: new, tagged recherche", () => {
    const fragment = read("packages/help/releases/unreleased/761.md");
    expect(fragment).toMatch(/^kind: new$/m);
    expect(fragment).toMatch(/^tags: \[.*recherche.*\]$/m);
    expect(fragment).toMatch(/^## en$/m);
  });
});
