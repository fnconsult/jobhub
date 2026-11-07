import { readFileSync } from "node:fs";
import { API_VERSION, API_VERSION_HEADER } from "@jobhub/shared";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { offerBoxResponseSchema } from "@jobhub/shared/reads";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #819 (ADR-0090, « Offres à traiter 5 »): a Capture or a Share capture the Candidate follows enters the Offer box
// already « Suivie », under « Extension » or « Partage »; one not followed leaves no entry; the chips filter them.
// Through the public entry points: the extension's HTTP calls (its Origin and API Version), the app's share
// (POST /api/share-captures, the careers site faked inside the server), and the page « Recherches d'offres ».
// The Side Panel itself, driven in the real extension, is e2e/extension.spec.ts's.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// The origin the suite's web server trusts for its unpacked extension (playwright.config.ts: EXTENSION_ORIGINS).
const EXTENSION = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;
const extension = { origin: EXTENSION, [API_VERSION_HEADER]: String(API_VERSION) };
const LINK = "https://carrieres.coach-links.e2e-jobbbox.fr/offres/daf-lyon";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ baseURL: origin });

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

const offerBox = async (page: Page) => offerBoxResponseSchema.parse(await (await page.request.get("/api/offer-box")).json());

async function candidate(browser: Browser, label: string) {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, profileId: (await created.json()).id as string };
}

/** A Capture, as the Side Panel sends it: the posting becomes the Candidate's Job Offer. */
async function capture(page: Page, title: string) {
  const response = await page.request.post("/api/job-offers", { headers: extension, data: { source: {}, title, content: `Un poste de test pour la Capture : ${title}.` } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).id as string;
}

async function share(page: Page) {
  const response = await page.request.post("/api/share-captures", { headers: { origin }, data: { url: LINK } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).jobOffer as { id: string; title: string };
}

test.describe("An Arrival source for a Capture or a Share capture followed (#819, ADR-0090)", () => {
  test("a Capture followed from the Side Panel makes an entry « Suivie » under « Extension »; a Capture not followed leaves none", async ({ browser }) => {
    const { page, profileId } = await candidate(browser, "arrival-capture");
    const notFollowed = await capture(page, `Capturée seulement ${tag}`);
    const followed = await capture(page, `Capturée et suivie ${tag}`);
    // Captured, not followed: nothing in the Offer box (no more than before).
    expect(await offerBox(page)).toMatchObject({ toHandle: 0, entries: [] });

    const saved = await page.request.post("/api/applications", { headers: extension, data: { jobOfferId: followed, profileId } });
    expect(saved.status(), await saved.text()).toBe(201);
    const { entries, toHandle } = await offerBox(page);
    expect(toHandle).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: "followed", applicationId: (await saved.json()).id, jobOffer: { id: followed }, profile: { id: profileId }, sources: [{ source: "extension" }] });
    expect(entries.some((entry) => entry.jobOffer.id === notFollowed)).toBe(false);
  });

  test("a Job Offer saved as an Application elsewhere than the Side Panel and the share (the web app) makes no entry", async ({ browser }) => {
    const { page, profileId } = await candidate(browser, "arrival-elsewhere");
    const offer = await capture(page, `Enregistrée ailleurs ${tag}`);
    const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: offer, profileId } });
    expect(saved.status(), await saved.text()).toBe(201);
    expect((await offerBox(page)).entries).toEqual([]);
  });

  test("a Share capture followed makes an entry « Suivie » under « Partage »; one not followed leaves none; a Capture followed adds « Extension » to it", async ({ browser }) => {
    const { page, profileId } = await candidate(browser, "arrival-share");
    const { id: offer } = await share(page);
    // Shared, not followed: the Private Job Offer and its conversation, no entry.
    expect(await offerBox(page)).toMatchObject({ toHandle: 0, entries: [] });

    const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: offer, profileId } });
    expect(saved.status(), await saved.text()).toBe(201);
    const [entry, ...others] = (await offerBox(page)).entries;
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ state: "followed", applicationId: (await saved.json()).id, jobOffer: { id: offer }, profile: { id: profileId }, sources: [{ source: "share" }] });

    // The same Application saved again, from the Side Panel: the one there is given back, « Extension » joins « Partage ».
    const again = await page.request.post("/api/applications", { headers: extension, data: { jobOfferId: offer, profileId } });
    expect(again.status(), await again.text()).toBe(200);
    const [completed, ...rest] = (await offerBox(page)).entries;
    expect(rest).toEqual([]);
    expect(completed!.id).toBe(entry!.id);
    expect(completed!.sources.map(({ source }) => source).sort()).toEqual(["extension", "share"]);
  });

  test("the chips « Extension » and « Partage » filter the entries that came that way", async ({ browser }) => {
    const { page, profileId } = await candidate(browser, "arrival-chips");
    const captured = `Capturée et suivie ${tag}`;
    const extensionOffer = await capture(page, captured);
    const { id: sharedOffer, title: sharedTitle } = await share(page);
    for (const [jobOfferId, headers] of [[extensionOffer, extension], [sharedOffer, { origin }]] as const) {
      expect((await page.request.post("/api/applications", { headers, data: { jobOfferId, profileId } })).status()).toBe(201);
    }

    await page.goto("/recherches");
    const region = page.getByRole("region", { name: /^Offres à traiter/ });
    const chips = region.getByRole("group", { name: fr.offerBox.chips });
    for (const source of ["all", "extension", "share"]) {
      await expect(chips.getByRole("button", { name: new RegExp(`^${fr.offerBox.sources[source]}, \\d+ à traiter$`) })).toBeVisible();
    }
    const row = (title: string) => region.getByRole("listitem", { name: title });
    const open = async () => {
      await region.locator("details.offer-box-followed").evaluateAll((all) => all.forEach((details) => ((details as HTMLDetailsElement).open = true)));
    };
    const chip = (source: string) => chips.getByRole("button", { name: new RegExp(`^${fr.offerBox.sources[source]}, `) });

    await chip("extension").click();
    await open();
    await expect(row(captured)).toBeVisible();
    await expect(row(sharedTitle)).toHaveCount(0);
    await expect(row(captured).getByText(fr.offerBox.followed, { exact: true })).toBeVisible();

    await chip("share").click();
    await open();
    await expect(row(sharedTitle)).toBeVisible();
    await expect(row(captured)).toHaveCount(0);

    await chip("all").click();
    await open();
    await expect(row(captured)).toBeVisible();
    await expect(row(sharedTitle)).toBeVisible();
  });
});
