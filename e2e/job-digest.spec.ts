import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe as subscribeToPlan } from "./support/plan";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";

// Issue #15: the Job Digest. A Candidate opts in per Profile, from the Profile
// page, picking daily or weekly within their Plan Quota (none on Free, weekly on
// Standard, daily on Premium). The real worker (apps/worker, `tsx src/main.ts`)
// makes it: its `job-digest.schedule` job (cron 07:00 Europe/Paris; sent here on
// demand, as the cron would) queues a `job-digest.run` per due Profile, which
// selects the Job Offers already stored that the Profile was never shown, runs
// Job discovery (the outside world faked by e2e/support/fake-job-sites.mjs) when
// they are too few, and emails the Job Digest in the Candidate's Interface
// Language, with a link to its page and an unsubscribe link. The worker prints
// its emails (MAIL_TRANSPORT=console) to its output, read here as the
// Candidate's mailbox. Other specs store Job Offers in the same database, as
// fitting as this run's (see STORED_ELSEWHERE): with the default week of look-back,
// a Profile's first Job Digest would be filled with them, Job discovery not
// needed. So this worker looks back no days (JOB_DIGEST_FIRST_LOOK_BACK_DAYS=0):
// a first Job Digest lists what Job discovery finds, and assertions name this run's Job Offers.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const admin = fr.admin;
const settingsTexts = admin.platformSettings;
// A super-admin of its own (playwright.config.ts's ADMIN_EMAILS): the one setting this spec edits, Paramètres.
const SUPER_ADMIN = "digest-threshold-office@e2e.jobbbox.test";
const THRESHOLD = "JOB_DIGEST_MIN_MATCH_SCORE";
// The sender this spec saves on Paramètres (#300): only this spec changes MAIL_FROM, so a sign-in elsewhere meanwhile is unaffected but for its sender.
const MAIL_FROM = "MAIL_FROM";
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-job-digest-${tag}`);
const SENDER = `Jobbbox E2E <digest-${tag}@jobbbox.test>`;

/** The two Job Offers the fake job sites publish for this run (see fake-job-sites.mjs). */
const DAF = `Directeur administratif et financier (H/F) – réf. ${tag}`;
const RESPONSABLE = `Responsable financier (lu par l'IA) – réf. ${tag}`;

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice administrative et financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};
const criteria = (targetRole: string) => ({ targetRole, locations: ["Lyon"], contractTypes: ["cdi"] });

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
  // tsx itself, not `npx tsx`: on Linux npx does not pass SIGTERM on, so afterAll would
  // leave this worker running, taking the next spec's jobs from the same queue.
  worker = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: path.resolve("apps/worker"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      APP_URL: origin,
      MAIL_TRANSPORT: "console",
      AI_FAKE: "",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_WEB_SEARCH_PROVIDER: "perplexity",
      MISTRAL_API_KEY: "e2e-mistral-key",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "0",
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

/** The worker's 07:00 Europe/Paris run, now: what its `job-digest.schedule` cron does every morning. */
async function scheduleTick() {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  try {
    await boss.send("job-digest.schedule", {});
  } finally {
    await boss.stop({ graceful: false });
  }
}

/**
 * As if the Candidate had opted in more than a week ago: a Job Digest is due at
 * the first 07:00 (Monday's, for a weekly one) after opting in, which the next
 * tick then finds passed. Without it, a Profile opted in during the test is not due yet.
 */
async function optedInLastWeek(profileId: string) {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const moved = await database.query("UPDATE job_digest_subscription SET subscribed_at = subscribed_at - interval '8 days' WHERE profile_id = $1", [profileId]);
    expect(moved.rowCount).toBe(1);
  } finally {
    await database.end();
  }
}

/**
 * What the rest of the suite leaves in the shared database: Job Offers other
 * Candidates stored an hour ago, that fit this spec's Profiles as well as this
 * run's own (Match Score 100). There are more than a Job Digest's target count,
 * so this spec checks that they cannot crowd out the Job Offers it names, even
 * when it runs alone.
 */
const STORED_ELSEWHERE = Array.from({ length: 12 }, (_, index) => `DAF (H/F), stocké par un autre Candidat ${index + 1} – réf. ${tag}`);

async function storeElsewhere() {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    for (const [index, title] of STORED_ELSEWHERE.entries()) {
      await database.query(
        `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content, employer, location, contract_type, created_at)
         VALUES ($1, $1, $2, $3, $3, 'Ailleurs Industrie', 'Lyon', 'cdi', now() - interval '1 hour')`,
        [`e2e-job-digest-elsewhere-${tag}-${index}`, `https://ailleurs-e2e.example/offre/${tag}/${index}`, title],
      );
    }
  } finally {
    await database.end();
  }
}

async function forgetStoredElsewhere() {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query("DELETE FROM job_offer WHERE title = ANY($1::text[])", [STORED_ELSEWHERE]);
  } finally {
    await database.end();
  }
}

/** The worker's report lines for one Profile's Job Digest runs, oldest first. */
const digestReports = (profileId: string) => workerOutput.split("\n").filter((line) => line.startsWith(`[job-digest] profile ${profileId}:`));

async function waitForDigestRun(profileId: string, count: number): Promise<string> {
  await expect.poll(() => digestReports(profileId).length, { timeout: 90_000, message: workerOutput }).toBeGreaterThanOrEqual(count);
  return digestReports(profileId)[count - 1]!;
}

type Email = { from: string; subject: string; text: string };

/** The emails the worker sent to `address`, oldest first, with the sender printed under their first line. */
function emailsTo(address: string): Email[] {
  const marker = `[mail] to ${address}: `;
  return workerOutput
    .split(/^(?=\[)/m)
    .filter((block) => block.startsWith(marker))
    .map((block) => {
      const [first, ...rest] = block.trimEnd().split("\n");
      const from = rest[0]?.startsWith("From: ") ? rest.shift()!.slice("From: ".length) : "";
      return { from, subject: first!.slice(marker.length), text: rest.join("\n") };
    });
}

/** The unsubscribe page link at the foot of a Job Digest email. */
function unsubscribeLinkIn(email: Email): URL {
  const match = email.text.match(/https?:\/\/\S+\/desabonnement\?\S+/);
  if (!match) throw new Error(`no unsubscribe link in: ${email.text}`);
  return new URL(match[0]);
}

/** The link to the Job Digest's page in its email. */
function digestLinkIn(email: Email): URL {
  const match = email.text.match(/https?:\/\/\S+\/job-digests\/[0-9a-f-]{36}/);
  if (!match) throw new Error(`no Job Digest link in: ${email.text}`);
  return new URL(match[0]);
}

async function signIn(page: Page, label: string, plan?: "standard" | "premium"): Promise<string> {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  if (plan) await subscribeToPlan(page, email, plan);
  return email;
}

async function createProfile(page: Page, targetRole = "Directrice administrative et financière"): Promise<string> {
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: criteria(targetRole) } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

async function switchToEnglish(page: Page) {
  const updated = await page.request.post("/api/auth/update-user", { headers: { origin }, data: { interfaceLanguage: "en" } });
  expect(updated.status(), await updated.text()).toBe(200);
}

/**
 * A Profile's Job Digest on the Job Digests page (ADR-0024), named after the Profile: that Profile's
 * when given, else the first (these Candidates have one active Profile).
 */
const jobDigestSection = (page: Page, profileId?: string) => (profileId ? page.locator(`#job-digest-${profileId}`) : page.locator('section[id^="job-digest-"]').first());

/** Opts in from the Profile page's Job Digest Section, at the frequency it proposes (the Plan's). */
async function optIn(page: Page, profileId: string, strings = fr) {
  await page.goto("/job-digests");
  const section = jobDigestSection(page, profileId);
  await section.getByRole("button", { name: strings.jobDigest.subscribe, exact: true }).click();
  await expect(section.getByRole("status")).toHaveText(strings.jobDigest.subscribed);
}

/** The Match Scores a results page shows, top to bottom. */
async function matchScoresOn(page: Page): Promise<number[]> {
  return (await page.getByText(/^Score de correspondance : \d+ \/ 100$/).allTextContents()).map((text) => Number(/(\d+) \//.exec(text)![1]));
}

test.describe("Job Digest", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
    await storeElsewhere();
    startWorker();
    await expect.poll(() => workerOutput, { timeout: 90_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
  });

  test.afterAll(async () => {
    if (worker && worker.exitCode === null) {
      const exited = new Promise((resolve) => worker!.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    rmSync(workDir, { recursive: true, force: true });
    await forgetStoredElsewhere();
    // Whatever happened, the next spec finds the threshold as env and the code leave it.
    const database = new Client({ connectionString: databaseUrl });
    await database.connect();
    try {
      await database.query("DELETE FROM platform_setting WHERE name = ANY($1::text[])", [[THRESHOLD, MAIL_FROM]]);
      await database.query("SELECT pg_notify('platform_settings_changed', '')");
    } finally {
      await database.end();
    }
  });

  test("the Match Score a Job Digest needs follows Paramètres within seconds, no worker restart: a Back Office value over the code's default, « Rétablir » back to it (#299)", async ({ page, browser }) => {
    await signIn(page, "digest-threshold", "standard");
    // Job Offers the Profile fits poorly: another city, another contract, a salary above what they pay. Under the
    // default threshold (60) none qualifies.
    const poorFit = {
      masterCv: { ...masterCv, fullName: "Boris Boulanger", headline: "Boulanger pâtissier", summary: "Un an de pétrin.", experience: [{ title: "Boulanger", employer: "Fournil", location: "Marseille", period: "2023 – 2024", description: "Pain." }], skills: ["Pain"] },
      searchCriteria: { targetRole: "Boulanger", locations: ["Marseille"], contractTypes: ["cdd"], minSalary: 200_000 },
    };
    const createPoorFitProfile = async () => {
      const created = await page.request.post("/api/profiles", { headers: { origin }, data: poorFit });
      expect(created.status(), await created.text()).toBe(201);
      const id = (await created.json()).id as string;
      await optIn(page, id);
      await optedInLastWeek(id);
      return id;
    };
    const first = await createPoorFitProfile();

    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const office = await context.newPage();
    try {
      await signInWithMagicLink(office, SUPER_ADMIN);
      await office.goto("/admin/parametres?tab=sources");
      const setting = office.locator(`tr[data-setting="${THRESHOLD}"]`);
      const sourceOf = () => setting.getByRole("cell").nth(1);
      await expect(setting.getByRole("cell").nth(0)).toHaveText("60");

      // The code's default: the Job Offers do not reach 60, nothing is sent.
      await scheduleTick();
      expect(await waitForDigestRun(first, 1)).toBe(`[job-digest] profile ${first}: nothing to send, Job discovery ran`);

      // The Back Office lowers the threshold; the running worker applies it to the next Job Digest.
      await setting.getByRole("textbox", { name: settingsTexts.newValue.replace("{{name}}", THRESHOLD) }).fill("0");
      await setting.getByRole("button", { name: settingsTexts.save }).click();
      await expect(office.getByRole("status").filter({ hasText: THRESHOLD })).toHaveText(settingsTexts.notices.saved.replace("{{name}}", THRESHOLD));
      await expect(sourceOf()).toContainText(settingsTexts.sources.back_office);
      // NOTIFY reaches the worker within seconds; its 60 s refresh is the fallback.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const second = await createPoorFitProfile();
      await scheduleTick();
      expect(await waitForDigestRun(second, 1)).toMatch(new RegExp(`^\\[job-digest\\] profile ${second}: Job Digest sent \\(\\d+ Job Offer\\(s\\)\\)`));

      // « Rétablir »: the code's default again, nothing qualifies.
      await setting.getByRole("button", { name: settingsTexts.restore }).click();
      await expect(office.getByRole("status").filter({ hasText: THRESHOLD })).toHaveText(settingsTexts.notices.restored.replace("{{name}}", THRESHOLD));
      await expect(sourceOf()).toHaveText(settingsTexts.sources.default);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      // Opted in only now: a tick makes every Profile due, so one opted in earlier would have been decided under the lowered threshold.
      const third = await createPoorFitProfile();
      await scheduleTick();
      expect(await waitForDigestRun(third, 1)).toBe(`[job-digest] profile ${third}: nothing to send, Job discovery ran`);
    } finally {
      await context.close();
    }
  });

  test("the next sign-in email and the next Job Digest are sent as the MAIL_FROM saved on Paramètres, no restart; « Rétablir » goes back, all in the Journal (#300)", async ({ page, browser }) => {
    const address = await signIn(page, "digest-sender", "standard");
    const profileId = await createProfile(page);
    await optIn(page, profileId);
    await optedInLastWeek(profileId);

    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const office = await context.newPage();
    /** The sign-in email a person new to Jobbbox receives, signing up in a browser of their own. */
    const newcomerSignIn = async (label: string) => {
      const newcomer = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
      try {
        return await signInWithMagicLink(await newcomer.newPage(), newAddress(label));
      } finally {
        await newcomer.close();
      }
    };
    try {
      await signInWithMagicLink(office, SUPER_ADMIN);
      await office.goto("/admin/parametres?tab=e-mail");
      const setting = office.locator(`tr[data-setting="${MAIL_FROM}"]`);
      const valueOf = () => setting.getByRole("cell").nth(0);
      // Env's sender, else the code's: what « Rétablir » goes back to.
      const before = (await valueOf().innerText()).trim();
      // MAIL_TRANSPORT stays env's: shown, never a field.
      await expect(office.locator('tr[data-setting="MAIL_TRANSPORT"]').getByRole("textbox")).toHaveCount(0);

      await setting.getByRole("textbox", { name: settingsTexts.newValue.replace("{{name}}", MAIL_FROM) }).fill(SENDER);
      await setting.getByRole("button", { name: settingsTexts.save }).click();
      await expect(office.getByRole("status").filter({ hasText: MAIL_FROM })).toHaveText(settingsTexts.notices.saved.replace("{{name}}", MAIL_FROM));
      await expect(valueOf()).toHaveText(SENDER);
      await expect(setting.getByRole("cell").nth(1)).toContainText(settingsTexts.sources.back_office);
      // NOTIFY reaches the web app and the worker within seconds; their 60 s refresh is the fallback.
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // The web app's next sign-in email.
      expect((await newcomerSignIn("digest-sender-newcomer")).from).toBe(SENDER);
      // The running worker's next Job Digest.
      await scheduleTick();
      expect(await waitForDigestRun(profileId, 1)).toMatch(new RegExp(`^\\[job-digest\\] profile ${profileId}: Job Digest sent`));
      await expect.poll(() => emailsTo(address).length).toBe(1);
      expect(emailsTo(address)[0]!.from).toBe(SENDER);

      // « Rétablir »: the next email goes out as before.
      await setting.getByRole("button", { name: settingsTexts.restore }).click();
      await expect(office.getByRole("status").filter({ hasText: MAIL_FROM })).toHaveText(settingsTexts.notices.restored.replace("{{name}}", MAIL_FROM));
      await expect(valueOf()).toHaveText(before);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect((await newcomerSignIn("digest-sender-after")).from).toBe(before);

      await office.goto("/admin/journal?section=platform_settings");
      const entries = office.getByRole("row").filter({ hasText: MAIL_FROM }).filter({ hasText: SENDER });
      const value = settingsTexts.journalFields.value;
      await expect(entries.filter({ hasText: admin.journal.actions.updated })).toContainText(
        admin.journal.changed.replace("{{field}}", value).replace("{{before}}", before).replace("{{after}}", SENDER),
      );
      await expect(entries.filter({ hasText: admin.journal.actions.restored_to_default })).toContainText(
        admin.journal.changed.replace("{{field}}", value).replace("{{before}}", SENDER).replace("{{after}}", before),
      );
    } finally {
      await context.close();
    }
  });

  test("is not included in the Free Plan: opting in shows the Upgrade Prompt, and no Job Digest is made", async ({ page }) => {
    await signIn(page, "digest-free");
    const profileId = await createProfile(page);
    await page.goto("/job-digests");
    const section = jobDigestSection(page);
    await expect(page.getByRole("main")).toContainText(fr.jobDigest.hint);

    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();

    const prompt = section.getByRole("alert").filter({ hasText: fr.billing.quotaReached.title });
    await expect(prompt).toContainText("La réception du Job Digest n'est pas comprise dans l'offre Gratuite. L'offre Standard la comprend.");
    await expect(prompt.getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute("href", "/abonnement");
    await page.reload();
    await expect(section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await expect(section.getByText(fr.jobDigest.subscribed)).toHaveCount(0);

    // The HTTP API says the same.
    const refused = await page.request.put(`/api/profiles/${profileId}/job-digest`, { headers: { origin }, data: { frequency: "weekly" } });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toMatchObject({ error: "not_included", plan: "free", upgradeTo: "standard" });
  });

  test("Standard, in French: weekly at most; due at 07:00, not on opting in; the email links to the Job Digest's page, ranked by Match Score, also listed on the Profile; the link unsubscribes", async ({ page }) => {
    const address = await signIn(page, "digest-standard", "standard");
    const profileId = await createProfile(page);
    const otherProfileId = await createProfile(page, "Responsable financière");
    const justOptedIn = await createProfile(page, "Contrôleuse de gestion");

    await page.goto("/job-digests");
    const section = jobDigestSection(page, profileId);
    await expect(section).toContainText(fr.jobDigest.frequency.weekly);
    await expect(section.getByRole("radio", { name: fr.jobDigest.frequencyOptions.weekly })).toBeChecked();

    // Daily is above the Standard Plan: refused by the server, with the Plan that has it.
    await section.getByRole("radio", { name: fr.jobDigest.frequencyOptions.daily }).check();
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("alert").filter({ hasText: fr.billing.quotaReached.title })).toContainText(
      "Le Job Digest quotidien n'est pas compris dans l'offre Standard. L'offre Premium le comprend.",
    );
    const refused = await page.request.put(`/api/profiles/${profileId}/job-digest`, { headers: { origin }, data: { frequency: "daily" } });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toMatchObject({ error: "above_plan", plan: "standard", upgradeTo: "premium" });

    await section.getByRole("radio", { name: fr.jobDigest.frequencyOptions.weekly }).check();
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await expect(section).toContainText(fr.jobDigest.schedule.weekly);
    await expect(section.getByRole("button", { name: fr.jobDigest.unsubscribe })).toBeVisible();

    await optedInLastWeek(profileId);
    await optIn(page, justOptedIn);
    await scheduleTick();

    expect(await waitForDigestRun(profileId, 1)).toMatch(new RegExp(`^\\[job-digest\\] profile ${profileId}: Job Digest sent \\(\\d+ Job Offer\\(s\\)\\), Job discovery ran$`));
    await expect.poll(() => emailsTo(address).length).toBe(1);
    const [email] = emailsTo(address);
    expect(email!.subject).toMatch(/^Job Digest « Directrice administrative et financière » : \d+ nouvelles offres$/);
    expect(email!.text).toContain("Bonjour,\n\nVotre coach a trouvé");
    expect(email!.text).toContain("pour votre profil « Directrice administrative et financière »");
    expect(email!.text).toContain(`- ${DAF} (Acme Industrie, Lyon (69002))`);
    expect(email!.text).toContain(`- ${RESPONSABLE} (Cabinet Lumière, Lyon)`);
    expect(email!.text).toMatch(/score de correspondance : \d+ \/ 100/);
    // The freshness rule (#116): the careers page's JobPosting dates the DAF; the page only the LLM read states no date.
    const blockOf = (title: string) => email!.text.split("\n\n").find((block) => block.startsWith(`- ${title}`))!;
    expect(blockOf(DAF)).toMatch(/publiée le \d{1,2} \S+ \d{4}/);
    expect(blockOf(RESPONSABLE)).toContain("date de publication : date inconnue");
    expect(email!.text).toContain("L'équipe Jobbbox");
    expect(email!.text).toContain("Ne plus recevoir le Job Digest de ce profil :");
    const unsubscribeLink = unsubscribeLinkIn(email!);
    expect(unsubscribeLink.origin).toBe(origin);
    expect(unsubscribeLink.searchParams.get("lang")).toBe("fr");
    // Opt-in is per Profile: the other Profile was not opted in, and the one opted in just now is not due before 07:00.
    expect(digestReports(otherProfileId)).toEqual([]);
    expect(digestReports(justOptedIn)).toEqual([]);

    // The email's link opens the Job Digest's page: its Job Offers, best Match Score first, each one to save.
    const digestLink = digestLinkIn(email!);
    expect(digestLink.origin).toBe(origin);
    await page.goto(digestLink.pathname);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Job Digest « Directrice administrative et financière »");
    await expect(page.getByRole("heading", { level: 2, name: DAF })).toBeVisible();
    const responsable = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: RESPONSABLE }) });
    await expect(responsable).toHaveCount(1);
    await expect(responsable.getByText("date inconnue", { exact: true })).toBeVisible();
    const daf = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: DAF }) });
    await expect(daf.getByText(/^Publiée le \d{1,2} \S+ \d{4}$/)).toBeVisible();
    await expect(daf).not.toContainText("date inconnue");
    const scores = await matchScoresOn(page);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(60);
    await responsable.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(responsable.getByText("Enregistrée", { exact: true })).toBeVisible();

    // The Profile page lists it, linking to the same page.
    await page.goto("/job-digests");
    await expect(section.getByRole("heading", { name: fr.jobDigest.latestTitle })).toBeVisible();
    await section.getByRole("link", { name: /^Job Digest du .+ : \d+ offres$/ }).click();
    await expect(page).toHaveURL(digestLink.pathname);

    // Weekly: the next tick sends nothing more for this Profile. The other
    // Profile, opted in a week ago, is due on that tick, so once it is reported the tick is over.
    await optIn(page, otherProfileId);
    await optedInLastWeek(otherProfileId);
    await scheduleTick();
    await waitForDigestRun(otherProfileId, 1);
    expect(digestReports(profileId)).toHaveLength(1);

    // The email's unsubscribe link: no sign-in needed, it asks first, then it is done.
    const visitor = await page.context().browser()!.newPage({ locale: "en-US" });
    try {
      await visitor.goto(unsubscribeLink.toString());
      await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(fr.jobDigest.unsubscribePage.title);
      await expect(visitor.locator("html")).toHaveAttribute("lang", "fr");
      await visitor.getByRole("button", { name: fr.jobDigest.unsubscribePage.action }).click();
      await expect(visitor.getByRole("status")).toHaveText(fr.jobDigest.unsubscribePage.done);
      // Used again, it says it no longer works.
      await visitor.goto(unsubscribeLink.toString());
      await visitor.getByRole("button", { name: fr.jobDigest.unsubscribePage.action }).click();
      await expect(visitor.getByRole("alert").filter({ hasText: fr.jobDigest.unsubscribePage.invalid })).toBeVisible();
    } finally {
      await visitor.close();
    }
    await page.goto("/job-digests");
    await expect(jobDigestSection(page, profileId).getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await expect(jobDigestSection(page, profileId).getByText(fr.jobDigest.subscribed)).toHaveCount(0);
    // Only that Profile's Job Digest was stopped.
    await expect(jobDigestSection(page, otherProfileId).getByRole("status")).toHaveText(fr.jobDigest.subscribed);
  });

  test("Premium, in English: daily, the email is in the Candidate's Interface Language, and the mail client's one-click unsubscribe works", async ({ page }) => {
    const address = await signIn(page, "digest-premium", "premium");
    await switchToEnglish(page);
    const profileId = await createProfile(page);

    await page.goto("/job-digests");
    const section = jobDigestSection(page);
    await expect(section).toContainText(en.jobDigest.frequency.daily);
    await expect(section.getByRole("radio", { name: en.jobDigest.frequencyOptions.daily })).toBeChecked();
    await section.getByRole("button", { name: en.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(en.jobDigest.subscribed);
    await expect(section).toContainText(en.jobDigest.schedule.daily);

    await optedInLastWeek(profileId);
    await scheduleTick();

    await waitForDigestRun(profileId, 1);
    await expect.poll(() => emailsTo(address).length).toBe(1);
    const [email] = emailsTo(address);
    expect(email!.subject).toMatch(/^Job Digest “Directrice administrative et financière”: \d+ new job offers?$/);
    expect(email!.text).toContain("Hello,\n\nYour coach found");
    expect(email!.text).toMatch(/match score: \d+ \/ 100/);
    expect(email!.text).toMatch(/See the (job offer|\d+ job offers):/);
    expect(digestLinkIn(email!).origin).toBe(origin);
    expect(email!.text).toContain("The Jobbbox team");
    expect(email!.text).toContain("Stop receiving this profile's Job Digest:");
    expect(email!.text).not.toContain("Bonjour");
    const unsubscribeLink = unsubscribeLinkIn(email!);
    expect(unsubscribeLink.searchParams.get("lang")).toBe("en");

    // The unsubscribe page speaks the email's language, even to a French browser.
    const visitor = await page.context().browser()!.newPage({ locale: "fr-FR" });
    try {
      await visitor.goto(unsubscribeLink.toString());
      await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(en.jobDigest.unsubscribePage.title);
      // Screen readers read it in English too.
      await expect(visitor.locator("html")).toHaveAttribute("lang", "en");
    } finally {
      await visitor.close();
    }

    // One-click unsubscribe (RFC 8058): the mail client POSTs, without a session, to the same token.
    const token = unsubscribeLink.searchParams.get("token")!;
    const oneClick = await page.context().browser()!.newContext();
    try {
      const done = await oneClick.request.post(`${origin}/api/job-digests/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
      expect(done.status()).toBe(200);
      expect(await done.json()).toEqual({ unsubscribed: true });
      const again = await oneClick.request.post(`${origin}/api/job-digests/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
      expect(again.status()).toBe(404);
    } finally {
      await oneClick.close();
    }
    await page.reload();
    await expect(section.getByRole("button", { name: en.jobDigest.subscribe, exact: true })).toBeVisible();
  });

  test("only sends Job Offers the Profile was never shown: not one its Job Search listed, saved as an Application or not; opting out and back in does not make it come sooner", async ({ page }) => {
    const address = await signIn(page, "digest-new-only", "standard");
    const profileId = await createProfile(page);
    const otherProfileId = await createProfile(page, "Responsable financière");

    // The Candidate ran a Job Search for the Profile: it listed both Job Offers, and they saved the DAF one.
    await page.goto(`/recherches?profil=${profileId}`);
    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    const daf = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: DAF }) });
    await expect(daf, workerOutput).toHaveCount(1, { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 2, name: RESPONSABLE })).toBeVisible();
    await daf.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(daf.getByText("Enregistrée", { exact: true })).toBeVisible();

    await optIn(page, profileId);
    await optedInLastWeek(profileId);
    await scheduleTick();

    // Both Job Offers are stored, and Job discovery finds them again: the Candidate saw both in the Job Search.
    await waitForDigestRun(profileId, 1);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    for (const email of emailsTo(address)) {
      expect(email.text).not.toContain(DAF);
      expect(email.text).not.toContain(RESPONSABLE);
    }

    // Opting out and back in keeps the weekly Plan Quota: not due again before next Monday's.
    const section = jobDigestSection(page);
    await page.goto("/job-digests");
    await section.getByRole("button", { name: fr.jobDigest.unsubscribe }).click();
    await expect(section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    // Another Profile, opted in a week ago, is due on the same tick: once it ran, the tick is over.
    await optIn(page, otherProfileId);
    await optedInLastWeek(otherProfileId);
    await scheduleTick();

    await waitForDigestRun(otherProfileId, 1);
    expect(digestReports(profileId)).toHaveLength(1);
  });

  test("stops when the Plan no longer includes it (Premium cancelled) and for an Archived Profile; a daily choice is sent weekly once Premium is lowered to Standard; a Candidate still entitled keeps receiving theirs", async ({ browser }) => {
    const fresh = async () => (await browser.newContext({ baseURL: origin })).newPage();
    const stripe = async (page: Page, event: ReturnType<typeof subscriptionEvent>) => {
      const { payload, signature } = signedEvent(event);
      const webhook = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
      expect(webhook.status()).toBe(200);
    };
    let page = await fresh();
    // Candidate whose Premium Plan is cancelled after opting in.
    const cancelled = await signIn(page, "digest-cancelled", "premium");
    const cancelledProfile = await createProfile(page);
    await optIn(page, cancelledProfile);
    await stripe(
      page,
      subscriptionEvent("customer.subscription.deleted", { customer: fakeCustomerId(cancelled), price: FAKE_STRIPE_PRICES.premium, status: "canceled" }, new Date(Date.now() + 5_000)),
    );

    // Candidate who archives the opted-in Profile.
    page = await fresh();
    const archiver = await signIn(page, "digest-archived", "standard");
    const archivedProfile = await createProfile(page);
    await optIn(page, archivedProfile);
    const archived = await page.request.patch(`/api/profiles/${archivedProfile}`, { headers: { origin }, data: { archived: true } });
    expect(archived.status(), await archived.text()).toBe(200);

    // Candidate who picked daily on Premium, then went down to Standard: the Profile page says it now comes on Mondays.
    page = await fresh();
    const lowered = await signIn(page, "digest-lowered", "premium");
    const loweredProfile = await createProfile(page);
    await optIn(page, loweredProfile);
    await expect(jobDigestSection(page)).toContainText(fr.jobDigest.schedule.daily);
    await stripe(
      page,
      subscriptionEvent("customer.subscription.updated", { customer: fakeCustomerId(lowered), price: FAKE_STRIPE_PRICES.standard, status: "active" }, new Date(Date.now() + 5_000)),
    );
    await page.reload();
    await expect(jobDigestSection(page).getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await expect(jobDigestSection(page)).toContainText(fr.jobDigest.schedule.weekly);
    await expect(jobDigestSection(page)).toContainText(fr.jobDigest.cappedToPlan);

    // A Candidate still entitled: their Job Digest tells us the tick is over.
    page = await fresh();
    const entitled = await signIn(page, "digest-entitled", "standard");
    const entitledProfile = await createProfile(page);
    await optIn(page, entitledProfile);

    for (const profile of [cancelledProfile, archivedProfile, entitledProfile]) await optedInLastWeek(profile);
    await scheduleTick();
    await waitForDigestRun(entitledProfile, 1);
    await expect.poll(() => emailsTo(entitled).length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(digestReports(cancelledProfile)).toEqual([]);
    expect(digestReports(archivedProfile)).toEqual([]);
    expect(emailsTo(cancelled)).toEqual([]);
    expect(emailsTo(archiver)).toEqual([]);
    expect(emailsTo(lowered)).toEqual([]);
  });
});
