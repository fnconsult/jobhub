import { readFileSync } from "node:fs";
import { API_VERSION, API_VERSION_HEADER } from "@jobhub/shared";
import { gettingStartedResponseSchema } from "@jobhub/shared/reads";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { toConversation } from "./support/conversation";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { newAddress } from "./support/mailbox";

// Issue #1069: « Pour bien commencer », in an empty conversation's help, for an account in its first 14 days: « L'ATS
// Score de mon CV » until an ATS Score exists, then « Garder une offre vue sur un autre site » on Chrome on a computer,
// while the extension is published and until a first Capture from it. Driven in Chromium on a computer.
//
// The extension counts as published while EXTENSION_STORE_URL is set, a Platform Setting global to the suite's database:
// this spec sets it, so it runs in its own project, after every web spec (playwright.config.ts: getting-started), and
// puts it back as env leaves it, with none.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const help = fr.coachPanel.help;
const origin = process.env.E2E_WEB_ORIGIN!;
const STORE = "EXTENSION_STORE_URL";
const STORE_PAGE = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
// The origin the suite's web server trusts for its unpacked extension (playwright.config.ts: EXTENSION_ORIGINS).
const extension = { origin: `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`, [API_VERSION_HEADER]: String(API_VERSION) };
const titleOf = (id: string) => /^title: "?(.+?)"?$/m.exec(readFileSync(`packages/help/articles/fr/${id}.md`, "utf8"))![1]!;

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

async function setting(value: string | null) {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    if (value === null) await client.query("DELETE FROM platform_setting WHERE name = $1", [STORE]);
    else
      await client.query(
        `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, 'e2e@jobbbox.ai')
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
        [STORE, value],
      );
    await client.query("SELECT pg_notify('platform_settings_changed', '')");
  } finally {
    await client.end();
  }
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const gettingStarted = (page: Page) => conversation(page).getByRole("group", { name: help.gettingStarted.title });
const box = (page: Page) => conversation(page).getByLabel(fr.coachPanel.messageLabel);
const account = async (page: Page) => gettingStartedResponseSchema.parse(await (await page.request.get("/api/account/getting-started")).json()).account;

test.use({ baseURL: origin });

test.describe("« Pour bien commencer » in an empty conversation's help (#1069)", () => {
  test.beforeAll(async () => {
    await setting(STORE_PAGE);
  });
  test.afterAll(async () => {
    await setting(null);
  });

  test("a new account on Chrome on a computer sees the ATS Score then the extension; neither once it has an ATS Score and a Capture", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("getting-started"));
    // The setting is read through the resolver, in use within seconds.
    await expect(async () => expect((await account(page))?.extensionPublished).toBe(true)).toPass({ timeout: 15_000 });
    await page.goto("/");
    await toConversation(page);

    const group = gettingStarted(page);
    await expect(group.getByRole("heading", { name: help.gettingStarted.title })).toBeVisible();
    await expect(group.getByRole("button")).toHaveText([help.gettingStarted.atsScore, help.gettingStarted.extension]);
    const results = await new AxeBuilder({ page }).include(".help-intro").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);

    // The keyboard, as in the rest of the help: ↓ to the next, Enter opens it, Escape goes back to the message box.
    await group.getByRole("button", { name: help.gettingStarted.atsScore }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(group.getByRole("button", { name: help.gettingStarted.extension })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(group.getByRole("button", { name: help.gettingStarted.atsScore })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const article = page.getByRole("complementary", { name: titleOf("page-install-extension") });
    await expect(article).toBeVisible();
    await expect(article).toContainText("Vous n'avez rien à recopier.");
    await group.getByRole("button", { name: help.gettingStarted.extension }).focus();
    await page.keyboard.press("Escape");
    await expect(box(page)).toBeFocused();

    // An ATS Score for the account's CV: « L'ATS Score de mon CV » goes.
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] } } });
    expect(created.status(), await created.text()).toBe(201);
    const profileId = (await created.json()).id as string;
    const scored = await page.request.post(`/api/profiles/${profileId}/ats-score`, { headers: { origin } });
    expect(scored.status(), await scored.text()).toBe(200);
    await page.goto("/");
    await toConversation(page);
    await expect(gettingStarted(page).getByRole("button")).toHaveText([help.gettingStarted.extension]);

    // A Capture from the extension: nothing is left, and the section goes.
    const captured = await page.request.post("/api/job-offers", { headers: extension, data: { source: {}, title: "Directrice financière", content: "Un poste de test pour « Pour bien commencer »." } });
    expect(captured.ok(), await captured.text()).toBe(true);
    expect(await account(page)).toMatchObject({ atsScore: true, extensionCapture: true });
    await page.goto("/");
    await toConversation(page);
    await expect(conversation(page)).toContainText(help.greeting);
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(conversation(page).getByText(help.gettingStarted.title)).toHaveCount(0);
  });
});
