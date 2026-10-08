import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #23: on the Premium Plan, named Enriched Contacts at the employer, from a
// licensed contact-data provider: people found by the Company Dossier's Suggested
// Contact Roles, whose details the Candidate asks for one by one (counted against
// the Plan Quota), each showing its source provider and retrieval date, and usable
// as the Outreach Message's recipient. The provider is Apollo, faked by
// e2e/support/fake-contact-provider.mjs; the register behind the dossier by
// e2e/support/fake-company-sources.mjs.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const t = fr.enrichedContacts;
const td = fr.tailoredDocuments;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** Signs a new Candidate in (on `plan`), saves a Job Offer from Acme Industrie, builds its Company Dossier unless told not to, and opens the Application page. */
async function openApplication(page: Page, { plan, dossier = true }: { plan: "free" | "premium"; dossier?: boolean }) {
  const email = newAddress("enriched-contacts");
  await signInWithMagicLink(page, email);
  if (plan === "premium") await subscribe(page, email, "premium");
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { title: "DAF H/F", content: `(réf. ${unique()}) Poste de DAF.`, employer: "Acme Industrie", location: "Lyon" },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  if (dossier) {
    const built = await page.request.post(`/api/applications/${id}/company-dossier`, { headers: { origin } });
    expect(built.ok(), await built.text()).toBe(true);
  }
  await page.goto(`/candidatures/${id}`);
  await page.waitForLoadState("networkidle");
  return { id, section: page.getByRole("region", { name: t.title }) };
}

test.describe("Enriched Contacts", () => {
  test("a Premium Candidate finds people at the employer, gets one's details with their source and date, and addresses the Outreach Message to them", async ({ page }) => {
    const { section } = await openApplication(page, { plan: "premium" });

    await section.getByRole("button", { name: t.find }).click();

    const found = section.getByRole("group", { name: t.foundTitle });
    await expect(found.getByText("Claire Ma***n")).toBeVisible();
    await expect(found.getByText("Hugo Be***d")).toBeVisible();

    await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Claire Ma***n") }).click();
    const contacts = section.getByRole("group", { name: t.contactsTitle });
    await expect(contacts.getByText("Claire Martin")).toBeVisible();
    await expect(contacts.getByRole("link", { name: "claire.martin@acme-industrie.example" })).toBeVisible();
    await expect(contacts.getByText(/Source : Apollo, coordonnées obtenues le \d+/)).toBeVisible();

    // The provider has nothing for Hugo: nothing is counted, and he stays among the people found.
    await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Hugo Be***d") }).click();
    await expect(section.getByRole("alert")).toHaveText(t.noDetails);
    await expect(found.getByText("Hugo Be***d")).toBeVisible();

    // The Outreach Message can be addressed to Claire: named in the draft, and the mail link is to her.
    await page.reload();
    const message = page.getByRole("group", { name: td.outreachMessage.title });
    await message.getByLabel(td.outreachMessage.recipientLabel).selectOption({ label: "Claire Martin · DRH" });
    await message.getByRole("button", { name: td.outreachMessage.draft }).click();
    await expect(message.getByText(td.outreachMessage.addressedTo.replace("{{name}}", "Claire Martin (DRH)"))).toBeVisible();
    const mail = (await message.getByRole("link", { name: td.outreachMessage.openInMail }).getAttribute("href"))!;
    expect(mail.startsWith("mailto:claire.martin@acme-industrie.example?")).toBe(true);
  });

  test("a Candidate whose Plan has no Enriched Contacts gets the Upgrade Prompt, and nobody is looked up", async ({ page }) => {
    const { id, section } = await openApplication(page, { plan: "free" });

    await section.getByRole("button", { name: t.find }).click();

    await expect(section.getByRole("alert").getByRole("link", { name: /Premium/ })).toBeVisible();
    await expect(section.getByRole("group", { name: t.foundTitle })).toHaveCount(0);
    const state = await (await page.request.get(`/api/applications/${id}/enriched-contacts`)).json();
    expect(state).toEqual({ enabled: true, searchable: true, found: [], contacts: [] });
  });

  test("without a Company Dossier there is nothing to look for yet", async ({ page }) => {
    const { section } = await openApplication(page, { plan: "premium", dossier: false });

    await expect(section.getByText(t.needsDossier)).toBeVisible();
    await expect(section.getByRole("button", { name: t.find })).toHaveCount(0);
  });

  test("another Candidate cannot read or reveal someone else's contacts", async ({ page, browser }) => {
    const { id, section } = await openApplication(page, { plan: "premium" });
    await section.getByRole("button", { name: t.find }).click();
    await expect(section.getByRole("group", { name: t.foundTitle })).toBeVisible();
    const { found } = await (await page.request.get(`/api/applications/${id}/enriched-contacts`)).json();

    const other = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(other, newAddress("enriched-contacts-other"));
    expect((await other.request.get(`/api/applications/${id}/enriched-contacts`)).status()).toBe(404);
    expect((await other.request.post(`/api/applications/${id}/enriched-contacts/${found[0].id}`, { headers: { origin } })).status()).toBe(404);
    await other.close();
  });
});
