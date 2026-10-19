import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #16, the rules of the Agent Brief that decide WHEN a Job Offer is an
// Expired Job Offer, WHICH ones are read, and what a Candidate can report:
//  - one gone check does not expire, two in a row do, a live check in between resets;
//  - an expired offer found published again is no longer expired;
//  - Forbidden-site offers, offers without URL and offers with no ongoing Application are never fetched;
//  - expiry never changes an Application Status;
//  - the badge shows in the list, the board, the Application page and the Job Offer page (fr + en);
//  - Reported Unavailable can be set and undone, and affects only that Candidate's Application.
// Driven like e2e/expired-job-offers.spec.ts: the worker's re-check job with its clock moved ahead,
// the job sites played by e2e/support/fake-source-sites.mjs, the Candidate through the web app.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-recheck-rules-${tag}`);
const requestLog = path.join(workDir, "requests.jsonl");
const HOUR = 3_600_000;
const DAY = 24;

const source = {
  twiceGone: `https://disparue-e2e.example/offre/${tag}/deux`,
  intermittent: `https://intermittent-e2e.example/offre/${tag}`,
  revenue: `https://revenue-e2e.example/offre/${tag}`,
  stable: `https://stable-e2e.example/offre/${tag}`,
  noApplication: `https://disparue-e2e.example/offre/${tag}/sans-candidature`,
  finalOnly: `https://disparue-e2e.example/offre/${tag}/terminee`,
  forbidden: `https://www.linkedin.com/jobs/view/${tag}`,
} as const;
type Name = keyof typeof source | "noUrl";
const titleOf = (name: Name) => `Offre ${name} – réf. ${tag}`;

const requests = (): { url: string }[] =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const fetchesOf = (url: string) => requests().filter((r) => r.url === url).length;

let capturedAt = 0;

function recheckAt(hoursAfterCapture: number, phase: "first" | "second" | "third" | "fourth" | "live") {
  for (let run = 0; run < 20; run++) {
    const result = spawnSync(
      path.resolve("node_modules/.bin/tsx"),
      ["e2e/support/worker-job.ts", "job-offers.recheck-sources", String((capturedAt + hoursAfterCapture * HOUR - Date.now()) / HOUR)],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          E2E_RECHECK_TAG: tag,
          E2E_RECHECK_LOG: requestLog,
          E2E_RECHECK_PHASE: phase,
          NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-source-sites.mjs")}`,
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const report = result.stdout.split("\n").find((line) => line.startsWith("[source-recheck]"));
    expect(report, result.stdout).toBeDefined();
    if (!/^\[source-recheck\] 100 Job Offer/.test(report!)) return;
  }
  throw new Error("The re-check never caught up");
}

async function expiredAt(request: APIRequestContext, id: string): Promise<string | undefined> {
  const response = await request.get(`${origin}/api/job-offers/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).expiredAt;
}

async function signInWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const profile = await page.request.post("/api/profiles", {
    headers: { origin },
    data: {
      masterCv: { fullName: "Claire Martin", headline: "DAF", email: "claire.martin@example.fr", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] },
      searchCriteria: { targetRole: "DAF", location: "Lyon" },
    },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  return (await profile.json()).id;
}

test.describe("Expired Job Offers: confirmation, scope and Reported Unavailable", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let page: Page;
  let other: Page;
  let profileId: string;
  const offerIds = {} as Record<Name, string>;
  const applications = {} as Record<string, { id: string; status: string }>;
  let otherApplicationId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
    page = await browser.newPage({ baseURL: origin });
    profileId = await signInWithProfile(page, "expired-rules");

    capturedAt = Date.now();
    const capture = async (name: Name) => {
      const url = name === "noUrl" ? undefined : source[name];
      const captured = await page.request.post("/api/job-offers", {
        headers: { origin },
        data: { source: url ? { url } : {}, title: titleOf(name), content: `Offre ${name} capturée (réf. ${tag}).`, location: "Lyon" },
      });
      expect(captured.status(), await captured.text()).toBe(200);
      offerIds[name] = (await captured.json()).id;
    };
    for (const name of [...(Object.keys(source) as Name[]), "noUrl"]) await capture(name);

    const follow = async (name: Name, status: string) => {
      const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: offerIds[name], profileId } });
      expect(saved.ok(), await saved.text()).toBe(true);
      const id: string = (await saved.json()).id;
      const changed = await page.request.patch(`/api/applications/${id}`, { headers: { origin }, data: { status } });
      expect(changed.status(), await changed.text()).toBe(200);
      applications[name] = { id, status };
    };
    // Ongoing Applications (not in a final Application Status), set by hand.
    await follow("twiceGone", "interview");
    await follow("intermittent", "applied");
    await follow("revenue", "followed_up");
    await follow("stable", "applied");
    await follow("forbidden", "applied");
    await follow("noUrl", "applied");
    // Only an Application in a final status: the Candidate is no longer applying.
    await follow("finalOnly", "abandoned");

    // A second Candidate follows the same still-published Job Offer.
    const otherContext = await browser.newContext({ baseURL: origin });
    other = await otherContext.newPage();
    const otherProfile = await signInWithProfile(other, "expired-rules-other");
    const saved = await other.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: offerIds.stable, profileId: otherProfile } });
    expect(saved.ok(), await saved.text()).toBe(true);
    otherApplicationId = (await saved.json()).id;
  });

  test.afterAll(async () => {
    await page?.close();
    await other?.context().close();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("one gone check does not expire a Job Offer, and only Job Offers an ongoing Application needs are read", async () => {
    recheckAt(3 * DAY + 1, "first");

    // Gone once (404, 410): not yet expired.
    for (const name of ["twiceGone", "intermittent", "revenue", "stable"] as Name[]) {
      expect(fetchesOf(source[name as keyof typeof source]), `${name} read`).toBe(1);
      expect(await expiredAt(page.request, offerIds[name]), `${name} expired`).toBeUndefined();
    }
    // Never read: no ongoing Application, only a final one, a Forbidden site (not even its robots.txt), no URL.
    expect(fetchesOf(source.noApplication)).toBe(0);
    expect(fetchesOf(source.finalOnly)).toBe(0);
    expect(fetchesOf(source.forbidden)).toBe(0);
    expect(requests().filter((r) => new URL(r.url).hostname.endsWith("linkedin.com"))).toEqual([]);
    expect(await expiredAt(page.request, offerIds.noUrl)).toBeUndefined();
  });

  test("two gone checks in a row expire it; a live check in between resets the count", async () => {
    recheckAt(6 * DAY + 2, "second");
    // twiceGone and revenue: gone twice in a row. intermittent: published this time.
    expect(await expiredAt(page.request, offerIds.twiceGone)).toBeDefined();
    expect(await expiredAt(page.request, offerIds.revenue)).toBeDefined();
    expect(await expiredAt(page.request, offerIds.intermittent)).toBeUndefined();
    expect(await expiredAt(page.request, offerIds.stable)).toBeUndefined();

    // intermittent: gone again, but the live check reset the count, so this is the first gone check.
    recheckAt(9 * DAY + 3, "third");
    expect(fetchesOf(source.intermittent)).toBe(3);
    expect(await expiredAt(page.request, offerIds.intermittent)).toBeUndefined();

    // ...and a second one in a row now expires it.
    recheckAt(12 * DAY + 4, "fourth");
    expect(await expiredAt(page.request, offerIds.intermittent)).toBeDefined();

    // Still never read: the offers that needed no re-check.
    expect(fetchesOf(source.noApplication)).toBe(0);
    expect(fetchesOf(source.finalOnly)).toBe(0);
    expect(fetchesOf(source.forbidden)).toBe(0);
  });

  test("expiry never changes an Application Status", async () => {
    for (const [name, { id, status }] of Object.entries(applications)) {
      const response = await page.request.get(`/api/applications/${id}`);
      expect(response.status(), await response.text()).toBe(200);
      expect((await response.json()).status, name).toBe(status);
    }
  });

  test("a Job Offer found published again is no longer expired", async () => {
    expect(await expiredAt(page.request, offerIds.revenue)).toBeDefined();
    recheckAt(21 * DAY, "live");
    expect(await expiredAt(page.request, offerIds.revenue)).toBeUndefined();
    expect(await expiredAt(page.request, offerIds.twiceGone)).toBeDefined();
  });

  for (const [language, t, label] of [["fr", fr, "French"], ["en", en, "English"]] as const) {
    test(`the badge shows in the list, the board, the Application page and the Job Offer page (${label})`, async () => {
      if (language === "en") {
        await page.goto("/compte/preferences");
        await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
        await expect(page.getByRole("status").filter({ hasText: en.account.saved })).toHaveText(en.account.saved);
      }
      const title = titleOf("twiceGone");
      const noticeStart = t.jobOffer.expired.split("{{date}}")[0];

      await page.goto("/candidatures");
      const row = page.getByRole("row", { name: new RegExp(title) });
      await expect(row.getByText(t.applications.expired, { exact: true })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(titleOf("stable")) }).getByText(t.applications.expired, { exact: true })).toHaveCount(0);

      await page.getByRole("link", { name: t.applications.boardView }).click();
      const column = page.getByRole("region", { name: t.applicationStatuses.interview });
      await expect(column.getByRole("listitem").filter({ hasText: title }).getByText(t.applications.expired, { exact: true })).toBeVisible();

      await page.goto(`/candidatures/${applications.twiceGone.id}`);
      await expect(page.getByText(t.applications.expired, { exact: true }).or(page.getByText(noticeStart))).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: t.application.expiredNotice })).toBeVisible();

      await page.goto(`/offres/${offerIds.twiceGone}`);
      await expect(page.getByRole("status").filter({ hasText: noticeStart })).toBeVisible();
    });
  }

  test("a Candidate reports a Job Offer unavailable on their Application and undoes it, without touching the other Candidate's", async () => {
    await page.goto("/compte/preferences");
    await page.getByLabel(en.account.interfaceLanguage).selectOption("fr");
    await expect(page.getByRole("status").filter({ hasText: fr.account.saved })).toHaveText(fr.account.saved);

    const mine = `/candidatures/${applications.stable.id}`;
    await page.goto(mine);
    await expect(page.getByText(fr.applications.expired, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /signaler/i }).click();
    await expect(page.getByText(fr.applications.expired, { exact: true })).toBeVisible();
    await expect(page.getByText(/signalé par vous/i).first()).toBeVisible();
    // Her Application keeps its status, and shows the same in the list.
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("applied");
    await page.goto("/candidatures");
    const row = page.getByRole("row", { name: new RegExp(titleOf("stable")) });
    await expect(row.getByText(fr.applications.expired, { exact: true })).toBeVisible();
    await expect(row.getByText(/signalé par vous/i)).toBeVisible();

    // The shared Job Offer is not expired, and the other Candidate's Application is not flagged.
    expect(await expiredAt(page.request, offerIds.stable)).toBeUndefined();
    const theirs = await other.request.get(`/api/applications/${otherApplicationId}`);
    expect((await theirs.json()).jobOffer.expiredAt).toBeUndefined();
    await other.goto(`/candidatures/${otherApplicationId}`);
    await expect(other.getByRole("heading", { level: 1 })).toHaveText(titleOf("stable"));
    await expect(other.getByText(fr.applications.expired, { exact: true })).toHaveCount(0);
    await other.goto("/candidatures");
    await expect(other.getByText(fr.applications.expired, { exact: true })).toHaveCount(0);

    // Undone: no badge any more.
    await page.goto(mine);
    await page.getByRole("button", { name: /annuler|retirer/i }).click();
    await expect(page.getByText(fr.applications.expired, { exact: true })).toHaveCount(0);
    await page.goto("/candidatures");
    await expect(page.getByRole("row", { name: new RegExp(titleOf("stable")) }).getByText(fr.applications.expired, { exact: true })).toHaveCount(0);
  });
});
