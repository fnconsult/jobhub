import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #367: a failed Tailored CV or Tailored Documents shows its Failure Reason in AI Activity, in light red, and the
// routes (Tailored CV, Tailored Documents, Company Dossier) give it in their `failed` event and error body, never with a
// word from the provider or the Candidate. The AI is faked inside the server (fake-mistral.mjs): "E2E_AI_DOWN" in the
// Job Offer makes Mistral answer 503 (« upstream unavailable »).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const td = fr.tailoredDocuments;
const tc = fr.tailoredCv;
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};

async function openApplication(page: Page, content: string): Promise<string> {
  await signInWithMagicLink(page, newAddress("failure-reason"));
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: "DAF (H/F)", content, employer: "Acme Industrie", location: "Lyon" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id as string;
}

const documents = (page: Page) => page.getByRole("region", { name: fr.application.documentsTitle });
async function tab(page: Page, name: string): Promise<Locator> {
  await documents(page).getByRole("tab", { name, exact: true }).click();
  return documents(page).getByRole("tabpanel", { name, exact: true });
}
const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
const dangerSurface = (element: Locator) =>
  element.evaluate((node) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--color-danger-surface)";
    node.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });

async function expectFailedWithReason(page: Page, kind: "tailored_cv" | "tailored_documents") {
  await aiActivityButton(page).click();
  const failed = paneOf(page).locator(".ai-activity-live").filter({ hasText: fr.aiActivity.kinds[kind] });
  await expect(failed).toContainText(/Échec à \d{2}:\d{2}/);
  await expect(failed.locator(".ai-activity-live-reason")).toHaveText(fr.failureReasons.provider_unavailable);
  expect(await failed.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(failed));
  await expect(failed).not.toContainText("upstream");
  await expect(failed).not.toContainText("503");
  await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();
}

test.describe("AI Activity: the Failure Reason of a failed action (#367)", () => {
  test("a Tailored CV and a Cover Letter whose provider fails show their reason in AI Activity, in light red", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF. E2E_AI_DOWN");
    await page.goto(`/candidatures/${id}/documents`);

    const cv = await tab(page, tc.tailored);
    await cv.getByRole("button", { name: tc.propose, exact: true }).click();
    await expect(cv.getByRole("alert")).toBeVisible();
    await expectFailedWithReason(page, "tailored_cv");

    const letter = await tab(page, td.coverLetter.title);
    await letter.getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(letter.getByRole("alert")).toBeVisible();
    await expectFailedWithReason(page, "tailored_documents");
  });

  test("a network cut on a Tailored CV still says « Elle n'a pas pu aboutir. »", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF.");
    await page.goto(`/candidatures/${id}/documents`);
    await page.route("**/tailored-cv", (route) => route.abort("internetdisconnected"));
    const cv = await tab(page, tc.tailored);
    await cv.getByRole("button", { name: tc.propose, exact: true }).click();
    await expect(cv.getByRole("alert")).toBeVisible();
    await aiActivityButton(page).click();
    const cut = paneOf(page).locator(".ai-activity-live");
    await expect(cut).toHaveCount(1);
    await expect(cut.locator(".ai-activity-live-reason")).toHaveText(fr.aiActivity.live.unknownReason);
  });

  test("the routes give the Failure Reason in their error body and `failed` event, without the provider's words", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF. E2E_AI_DOWN");
    const calls: [string, Record<string, unknown>][] = [
      [`/api/applications/${id}/tailored-cv`, {}],
      [`/api/applications/${id}/tailored-documents`, { document: "cover_letter" }],
      [`/api/applications/${id}/company-dossier`, {}],
    ];
    for (const [url, data] of calls) {
      const json = await page.request.post(url, { data, headers: { origin } });
      expect(json.status(), url).toBe(503);
      const body = await json.json();
      expect(body, url).toEqual({ error: "unavailable", reason: "provider_unavailable" });
      expect(JSON.stringify(body)).not.toMatch(/upstream|Acme/);

      const stream = await page.request.post(url, { data, headers: { origin, accept: "application/x-ndjson" } });
      const events = (await stream.text()).trim().split("\n").map((line) => JSON.parse(line));
      const failed = events.at(-1);
      expect(failed, url).toMatchObject({ type: "failed", status: 503, error: "unavailable", reason: "provider_unavailable" });
      expect(JSON.stringify(failed)).not.toMatch(/upstream|Acme/);
    }
  });

  test("the Failure Reason wordings are in French and English", () => {
    expect(en.failureReasons.provider_unavailable).toBeTruthy();
    expect(Object.keys(en.failureReasons).sort()).toEqual(Object.keys(fr.failureReasons).sort());
    expect(Object.keys(en.aiActivity.live).sort()).toEqual(Object.keys(fr.aiActivity.live).sort());
  });
});
