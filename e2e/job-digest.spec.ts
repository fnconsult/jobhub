import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe as subscribeToPlan } from "./support/plan";

// Issue #15: the Job Digest. A Candidate opts in per Profile, from the Profile
// page; their Plan Quota sets how often it comes (none on Free, weekly on
// Standard, daily on Premium). The real worker (apps/worker, `tsx src/main.ts`)
// makes it: its hourly `job-digest.schedule` tick (sent here on demand, as the
// cron would) queues a `job-digest.run` per due Profile, which runs Job
// discovery (the outside world faked by e2e/support/fake-job-sites.mjs) and
// emails the Job Offers the Profile was never shown before, in the Candidate's
// Interface Language, with an unsubscribe link. The worker prints its emails
// (MAIL_TRANSPORT=console) to its output, read here as the Candidate's mailbox.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-job-digest-${tag}`);

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
const criteria = (targetRole: string) => ({ targetRole, location: "Lyon", contractType: "cdi" });

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
  worker = spawn("npx", ["tsx", "src/main.ts"], {
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
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

/** The worker's hourly tick, now: what its `0 * * * *` schedule does every hour. */
async function scheduleTick() {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  try {
    await boss.send("job-digest.schedule", {});
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** The worker's report lines for one Profile's Job Digest runs, oldest first. */
const digestReports = (profileId: string) => workerOutput.split("\n").filter((line) => line.startsWith(`[job-digest] profile ${profileId}:`));

async function waitForDigestRun(profileId: string, count: number): Promise<string> {
  await expect.poll(() => digestReports(profileId).length, { timeout: 90_000, message: workerOutput }).toBeGreaterThanOrEqual(count);
  return digestReports(profileId)[count - 1]!;
}

type Email = { subject: string; text: string };

/** The emails the worker sent to `address`, oldest first. */
function emailsTo(address: string): Email[] {
  const marker = `[mail] to ${address}: `;
  return workerOutput
    .split(/^(?=\[)/m)
    .filter((block) => block.startsWith(marker))
    .map((block) => {
      const [first, ...rest] = block.trimEnd().split("\n");
      return { subject: first!.slice(marker.length), text: rest.join("\n") };
    });
}

/** The unsubscribe page link at the foot of a Job Digest email. */
function unsubscribeLinkIn(email: Email): URL {
  const match = email.text.match(/https?:\/\/\S+\/desabonnement\?\S+/);
  if (!match) throw new Error(`no unsubscribe link in: ${email.text}`);
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

const jobDigestSection = (page: Page, title = fr.jobDigest.sectionTitle) => page.getByRole("region", { name: title });

test.describe("Job Digest", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
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
  });

  test("is not included in the Free Plan: opting in shows the Upgrade Prompt, and no Job Digest is made", async ({ page }) => {
    await signIn(page, "digest-free");
    const profileId = await createProfile(page);
    await page.goto(`/profils/${profileId}`);
    const section = jobDigestSection(page);
    await expect(section).toContainText(fr.jobDigest.hint);

    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();

    const prompt = section.getByRole("alert").filter({ hasText: fr.billing.quotaReached.title });
    await expect(prompt).toContainText("La réception du Job Digest n'est pas comprise dans l'offre Gratuite. L'offre Standard la comprend.");
    await expect(prompt.getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute("href", "/abonnement");
    await page.reload();
    await expect(section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await expect(section.getByText(fr.jobDigest.subscribed)).toHaveCount(0);

    // The HTTP API says the same.
    const refused = await page.request.put(`/api/profiles/${profileId}/job-digest`, { headers: { origin } });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toMatchObject({ error: "not_included", plan: "free", upgradeTo: "standard" });
  });

  test("Standard, in French: opted in per Profile, weekly; the email lists the new Job Offers with an unsubscribe link, the Profile page keeps them, and the link unsubscribes", async ({ page }) => {
    const address = await signIn(page, "digest-standard", "standard");
    const profileId = await createProfile(page);
    const otherProfileId = await createProfile(page, "Responsable financière");

    await page.goto(`/profils/${profileId}`);
    const section = jobDigestSection(page);
    await expect(section).toContainText(fr.jobDigest.frequency.weekly);
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await expect(section.getByRole("button", { name: fr.jobDigest.unsubscribe })).toBeVisible();

    await scheduleTick();

    expect(await waitForDigestRun(profileId, 1)).toBe(`[job-digest] profile ${profileId}: 2 Job Offer(s) found, Job Digest sent`);
    await expect.poll(() => emailsTo(address).length).toBe(1);
    const [email] = emailsTo(address);
    expect(email!.subject).toBe("Job Digest « Directrice administrative et financière » : 2 nouvelles offres");
    expect(email!.text).toContain("Bonjour,\n\nVotre coach a trouvé 2 nouvelles offres pour votre profil « Directrice administrative et financière »");
    expect(email!.text).toContain(`- ${DAF} (Acme Industrie, Lyon (69002))`);
    expect(email!.text).toContain(`- ${RESPONSABLE} (Cabinet Lumière, Lyon)`);
    expect(email!.text).toMatch(/score de correspondance : \d+ \/ 100/);
    expect(email!.text).toContain(`${origin}/profils/${profileId}`);
    expect(email!.text).toContain("L'équipe Jobbbox");
    expect(email!.text).toContain("Ne plus recevoir le Job Digest de ce profil :");
    const unsubscribeLink = unsubscribeLinkIn(email!);
    expect(unsubscribeLink.origin).toBe(origin);
    expect(unsubscribeLink.searchParams.get("lang")).toBe("fr");
    // Opt-in is per Profile: the other Profile was not opted in, so it got none.
    expect(digestReports(otherProfileId)).toEqual([]);

    // The Profile page keeps the latest Job Digests.
    await page.reload();
    await expect(section.getByRole("heading", { name: fr.jobDigest.latestTitle })).toBeVisible();
    await expect(section.getByRole("link", { name: DAF })).toBeVisible();
    await expect(section.getByRole("link", { name: RESPONSABLE })).toBeVisible();

    // Weekly: the next hourly tick sends nothing more for this Profile. The other
    // Profile, opted in now, gets its first one on that tick, so once it is
    // reported the tick is over.
    await page.goto(`/profils/${otherProfileId}`);
    await jobDigestSection(page).getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(jobDigestSection(page).getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await scheduleTick();
    await waitForDigestRun(otherProfileId, 1);
    expect(digestReports(profileId)).toHaveLength(1);

    // The email's unsubscribe link: no sign-in needed, it asks first, then it is done.
    const visitor = await page.context().browser()!.newPage({ locale: "en-US" });
    try {
      await visitor.goto(unsubscribeLink.toString());
      await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(fr.jobDigest.unsubscribePage.title);
      await visitor.getByRole("button", { name: fr.jobDigest.unsubscribePage.action }).click();
      await expect(visitor.getByRole("status")).toHaveText(fr.jobDigest.unsubscribePage.done);
      // Used again, it says it no longer works.
      await visitor.goto(unsubscribeLink.toString());
      await visitor.getByRole("button", { name: fr.jobDigest.unsubscribePage.action }).click();
      await expect(visitor.getByRole("alert").filter({ hasText: fr.jobDigest.unsubscribePage.invalid })).toBeVisible();
    } finally {
      await visitor.close();
    }
    await page.goto(`/profils/${profileId}`);
    await expect(jobDigestSection(page).getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await expect(jobDigestSection(page).getByText(fr.jobDigest.subscribed)).toHaveCount(0);
    // Only that Profile's Job Digest was stopped.
    await page.goto(`/profils/${otherProfileId}`);
    await expect(jobDigestSection(page).getByRole("status")).toHaveText(fr.jobDigest.subscribed);
  });

  test("Premium, in English: daily, the email is in the Candidate's Interface Language, and the mail client's one-click unsubscribe works", async ({ page }) => {
    const address = await signIn(page, "digest-premium", "premium");
    await switchToEnglish(page);
    const profileId = await createProfile(page);

    await page.goto(`/profils/${profileId}`);
    const section = jobDigestSection(page, en.jobDigest.sectionTitle);
    await expect(section).toContainText(en.jobDigest.frequency.daily);
    await section.getByRole("button", { name: en.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(en.jobDigest.subscribed);

    await scheduleTick();

    expect(await waitForDigestRun(profileId, 1)).toBe(`[job-digest] profile ${profileId}: 2 Job Offer(s) found, Job Digest sent`);
    await expect.poll(() => emailsTo(address).length).toBe(1);
    const [email] = emailsTo(address);
    expect(email!.subject).toBe("Job Digest “Directrice administrative et financière”: 2 new job offers");
    expect(email!.text).toContain("Hello,\n\nYour coach found 2 new job offers for your profile “Directrice administrative et financière”");
    expect(email!.text).toMatch(/match score: \d+ \/ 100/);
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

  test("only sends Job Offers the Profile was never shown: not one saved as an Application, and not one in an earlier Job Digest", async ({ page }) => {
    const address = await signIn(page, "digest-new-only", "standard");
    const profileId = await createProfile(page);

    // The Candidate already found and saved the DAF Job Offer through a Job Search.
    await page.goto(`/profils/${profileId}`);
    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    const daf = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: DAF }) });
    await expect(daf, workerOutput).toHaveCount(1, { timeout: 90_000 });
    await daf.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(daf.getByText("Enregistrée dans vos candidatures.")).toBeVisible();

    await page.goto(`/profils/${profileId}`);
    const section = jobDigestSection(page);
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await scheduleTick();

    expect(await waitForDigestRun(profileId, 1)).toBe(`[job-digest] profile ${profileId}: 2 Job Offer(s) found, Job Digest sent`);
    await expect.poll(() => emailsTo(address).length).toBe(1);
    const [email] = emailsTo(address);
    expect(email!.subject).toBe("Job Digest « Directrice administrative et financière » : 1 nouvelle offre");
    expect(email!.text).toContain(RESPONSABLE);
    expect(email!.text).not.toContain(DAF);
    await page.reload();
    await expect(section.getByRole("link", { name: RESPONSABLE })).toBeVisible();
    await expect(section.getByRole("link", { name: DAF })).toHaveCount(0);

    // Opting out and back in makes it due again at once; Job discovery finds the
    // same two Job Offers, both already shown, so nothing is sent.
    await section.getByRole("button", { name: fr.jobDigest.unsubscribe }).click();
    await expect(section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true })).toBeVisible();
    await section.getByRole("button", { name: fr.jobDigest.subscribe, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(fr.jobDigest.subscribed);
    await scheduleTick();

    expect(await waitForDigestRun(profileId, 2)).toBe(`[job-digest] profile ${profileId}: 2 Job Offer(s) found, nothing new to send`);
    expect(emailsTo(address)).toHaveLength(1);
  });
});
