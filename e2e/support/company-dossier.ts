import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./candidate";
import { newAddress } from "./mailbox";

// A Candidate's Company Dossier (#17), for the specs that build one: e2e/company-dossier.spec.ts, and the Brave scenario
// of e2e/job-discovery-search-keys.spec.ts (#405), which owns the suite's one BRAVE_SEARCH_API_KEY row.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const t = fr.companyDossier;

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

/** Signs a new Candidate in with one Profile, saves a Job Offer from `employer` and opens its Application page. */
export async function openApplication(page: Page, employer: string | undefined, content = "Poste de DAF.") {
  const origin = process.env.E2E_WEB_ORIGIN!;
  await signInWithMagicLink(page, newAddress("company-dossier"));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { title: "DAF H/F", content: `(réf. ${unique()}) ${content}`, employer, location: "Lyon" },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const application = await page.request.post("/api/applications", {
    data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id },
    headers: { origin },
  });
  expect(application.ok(), await application.text()).toBe(true);
  await page.goto(`/candidatures/${(await application.json()).id}/dossier`);
  // The dossier's buttons only act once the page is hydrated.
  await page.waitForLoadState("networkidle");
  return page.getByRole("region", { name: t.title });
}

/** No private person's name from the register or the web search ever reaches the page. */
export async function expectNoPrivatePersonNamed(page: Page) {
  await expect(page.locator("body")).not.toContainText(/PAULINE|MARTIN|DURAND|Müller/);
}
