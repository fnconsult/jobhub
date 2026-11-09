import { readFileSync } from "node:fs";
import { API_VERSION, API_VERSION_HEADER } from "@jobhub/shared";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #919 (Extension Event 0): each AI call records the Surface it was asked from (« Origine »): a Match Score started
// by the extension (an extension's Origin) is recorded `extension`, from the web app `web`; the worker's calls are in
// origin-ai-calls-worker.spec.ts. The Back Office's Appels IA and Consommation IA are filtered by « Origine », « Inconnue »
// listing the calls recorded with none (those of before), and no request answers differently for its Surface.
// Driven through HTTP (POST /api/match-score) and the Back Office pages; the AI is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const origin = process.env.E2E_WEB_ORIGIN!;
const extensionOrigin = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;
const SUPER_ADMIN = "origin-office@e2e.jobbbox.test";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Cheffe de projet SI",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Cheffe de projet SI", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "IFRS, SAP." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};
const searchCriteria = { targetRole: "Chef de projet SI", locations: ["Lyon"], contractTypes: ["cdi"] };

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** A Job Offer made of a title and a text only: its Match Score reads the text with AI (phase 2, task offer_analysis). */
async function textOnlyOffer(api: APIRequestContext, name: string): Promise<string> {
  const captured = await api.post("/api/job-offers", {
    headers: { origin },
    data: { title: `Chef de projet SI H/F ${name}`, content: `Chef de projet SI (${name}). Type de contrat : CDI. Ville : Lyon. Compétences : IFRS, SAP.` },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

/** A Match Score asked with `headers` (the Origin it comes from); its status and answer. */
async function matchScore(api: APIRequestContext, jobOfferId: string, headers: Record<string, string>) {
  const response = await api.post("/api/match-score", { headers, data: { jobOfferId, cv: masterCv, searchCriteria } });
  return { status: response.status(), body: await response.json() };
}

const extensionHeaders = { origin: extensionOrigin, [API_VERSION_HEADER]: String(API_VERSION) };
const webHeaders = { origin };

/** The rows `offer_analysis` calls of Candidate `email` wrote in AI Usage and in the AI Message Log, oldest first. */
const callsOf = (email: string) =>
  query<{ id: string; usage_surface: string | null; log_surface: string | null }>(
    `SELECT u.id, u.surface AS usage_surface, m.surface AS log_surface
       FROM ai_usage u JOIN ai_message_log m ON m.usage_id = u.id JOIN candidate c ON c.id = m.candidate_id
      WHERE lower(c.email) = lower($1) AND u.task = 'offer_analysis' ORDER BY u.at, u.id`,
    [email],
  );

async function expectCalls(email: string, count: number) {
  let calls: Awaited<ReturnType<typeof callsOf>> = [];
  // An AI call is recorded just after its reply, never on its way.
  await expect.poll(async () => (calls = await callsOf(email)).length, { timeout: 20_000 }).toBe(count);
  return calls;
}

const table = (page: Page, name: string) => page.getByRole("table", { name });

test.describe("Origine of the AI calls (#919)", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a Match Score asked from the extension is recorded `extension`, from the web app `web`; both answer the same", async ({ page }) => {
    const email = newAddress("origin-record");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard"); // the Free plan allows one Match Score a week

    const fromExtension = await matchScore(page.request, await textOnlyOffer(page.request, `ext-${tag}-a`), extensionHeaders);
    expect(fromExtension.status, JSON.stringify(fromExtension.body)).toBe(200);
    const fromWeb = await matchScore(page.request, await textOnlyOffer(page.request, `web-${tag}-a`), webHeaders);
    expect(fromWeb.status, JSON.stringify(fromWeb.body)).toBe(200);

    const calls = await expectCalls(email, 2);
    expect(calls.map((call) => [call.usage_surface, call.log_surface])).toEqual([
      ["extension", "extension"],
      ["web", "web"],
    ]);

    // No request changes with its Surface: the same Match Score, whatever it comes from (the offers read alike).
    expect(fromExtension.body.score).toEqual(fromWeb.body.score);
    expect(Object.keys(fromExtension.body).sort()).toEqual(Object.keys(fromWeb.body).sort());

    // Another site is refused as before, whatever its Surface would have been, and records no AI call.
    const refused = await matchScore(page.request, await textOnlyOffer(page.request, `evil-${tag}-a`), { origin: "https://evil.example" });
    expect(refused.status).toBe(403);
    expect(await callsOf(email)).toHaveLength(2);
  });

  test("« Origine » restricts Appels IA and Consommation IA; « Inconnue » lists the calls recorded with none", async ({ page, browser }) => {
    const email = newAddress("origin-filter");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard"); // the Free plan allows one Match Score a week
    await matchScore(page.request, await textOnlyOffer(page.request, `ext-${tag}-b`), extensionHeaders);
    await matchScore(page.request, await textOnlyOffer(page.request, `web-${tag}-b`), webHeaders);
    await matchScore(page.request, await textOnlyOffer(page.request, `old-${tag}-b`), webHeaders);
    const [extensionCall, webCall, oldCall] = await expectCalls(email, 3);

    // Told apart in the Back Office by a model of their own; the third, as a call of before the column: no Surface at all.
    const models = { extension: `e2e-919-extension-${tag}`, web: `e2e-919-web-${tag}`, unknown: `e2e-919-unknown-${tag}` };
    await query(`UPDATE ai_usage SET model = $2 WHERE id = $1`, [extensionCall!.id, models.extension]);
    await query(`UPDATE ai_usage SET model = $2 WHERE id = $1`, [webCall!.id, models.web]);
    await query(`UPDATE ai_usage SET model = $2, surface = NULL WHERE id = $1`, [oldCall!.id, models.unknown]);
    await query(`UPDATE ai_message_log SET surface = NULL WHERE usage_id = $1`, [oldCall!.id]);

    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const office = await context.newPage();
    await signInWithMagicLink(office, SUPER_ADMIN);

    // Appels IA: the « Origine » filter and column, kept in the URL.
    await office.goto("/admin/activite/appels-ia");
    await office.getByLabel(admin.aiMessages.email).fill(email);
    await office.getByLabel(admin.aiMessages.task).selectOption("offer_analysis");
    await office.getByRole("button", { name: admin.aiMessages.apply }).click();
    const list = table(office, admin.aiMessages.caption);
    await expect(list.getByRole("columnheader", { name: admin.aiUsage.surface })).toBeVisible();
    await expect(list.getByRole("row").filter({ hasText: email })).toHaveCount(3);
    await expect(office.getByLabel(admin.aiUsage.surface)).toHaveValue("");

    const rowsOf = () => list.getByRole("row").filter({ hasText: email });
    const filterBy = async (surface: string) => {
      await office.getByLabel(admin.aiUsage.surface).selectOption(surface);
      await office.getByRole("button", { name: admin.aiMessages.apply }).click();
      await expect(office).toHaveURL(new RegExp(`surface=${surface}`));
    };
    await filterBy("extension");
    await expect(rowsOf()).toHaveCount(1);
    await expect(rowsOf()).toContainText(models.extension);
    await expect(rowsOf()).toContainText(admin.aiUsage.surfaces.extension);
    await filterBy("web");
    await expect(rowsOf()).toHaveCount(1);
    await expect(rowsOf()).toContainText(models.web);
    await filterBy("unknown");
    await expect(rowsOf()).toHaveCount(1);
    await expect(rowsOf()).toContainText(models.unknown);
    await expect(rowsOf()).toContainText(admin.aiUsage.surfaces.unknown);
    await filterBy("worker");
    await expect(rowsOf()).toHaveCount(0);

    // Its page says where the call came from.
    await office.goto(`/admin/activite/appels-ia?email=${encodeURIComponent(email)}&surface=extension`);
    await rowsOf().first().getByRole("link", { name: admin.aiMessages.open }).click();
    await expect(office.getByRole("term").filter({ hasText: admin.aiUsage.surface })).toBeVisible();
    await expect(office.getByRole("main")).toContainText(admin.aiUsage.surfaces.extension);

    // Consommation IA: the same filter, as `origine`, on the report's models.
    const byModel = table(office, admin.aiUsage.byModelCaption);
    const consumption = async (surface: string, shown: string[], hidden: string[]) => {
      await office.goto(`/admin/consommation-ia${surface ? `?origine=${surface}` : ""}`);
      await expect(office.getByLabel(admin.aiUsage.surface)).toHaveValue(surface);
      for (const model of shown) await expect(byModel).toContainText(model);
      for (const model of hidden) await expect(byModel).not.toContainText(model);
    };
    await consumption("", Object.values(models), []);
    await consumption("extension", [models.extension], [models.web, models.unknown]);
    await consumption("web", [models.web], [models.extension, models.unknown]);
    await consumption("unknown", [models.unknown], [models.extension, models.web]);

    // The same filter from the form, kept in the URL.
    await office.goto("/admin/consommation-ia");
    await office.getByLabel(admin.aiUsage.surface).selectOption("extension");
    await office.getByRole("button", { name: admin.aiUsage.show }).click();
    await expect(office).toHaveURL(/origine=extension/);
    await expect(byModel).toContainText(models.extension);
    await expect(byModel).not.toContainText(models.web);
    await expect(office.getByText(admin.aiUsage.surfaceExternal)).toBeVisible();
  });
});
