import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newAddress } from "./support/mailbox";
import {
  signInByEmail,
  startOwnServer,
  type OwnServer,
} from "./support/own-server";

// Issue #608 (ADR-0070): on a phone the conversation takes the whole screen, the Fiche and the Work Pane open full screen
// over it and close with ✕, the Sidebar stays a drawer; each column is a named region, focus enters the Work Pane when it
// opens and returns to its opener when it closes, the replies are announced as before, and the Tab order runs from the
// conversation to the columns. Runs on a server of its own; the AI Coach is faked inside it (fake-mistral.mjs).
const fr = JSON.parse(
  readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"),
);
const texts = fr.conversationFirst;
const fiche = fr.fiche;
const PORT_OFFSET = 608;
const masterCv = {
  fullName: "Marie Dupont",
  headline: "Responsable logistique",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [
    {
      title: "Responsable logistique",
      employer: "Carrefour Supply",
      location: "Lyon",
      period: "2010 – 2024",
      description: "Pilotage des entrepôts.",
    },
  ],
  education: [],
  skills: ["Supply chain", "WMS"],
  languages: [],
};

let server: OwnServer;

async function withProfile(
  page: Page,
  size: { width: number; height: number },
): Promise<string> {
  await page.setViewportSize(size);
  await signInByEmail(page, server, newAddress("conversation-phone"));
  const created = await page.request.post("/api/profiles", {
    data: {
      masterCv,
      searchCriteria: { targetRole: "Logistique", locations: ["Lyon"] },
    },
    headers: { origin: server.origin },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

const conversation = (page: Page) =>
  page.getByRole("region", { name: texts.label });
const ficheOf = (page: Page) =>
  page.getByRole("complementary", { name: fiche.label });
const topBar = (page: Page) => page.getByRole("banner");
const ficheButton = (page: Page) =>
  topBar(page).getByRole("button", { name: fiche.label, exact: true });

test.describe("« Conversation au centre »: the phone and the accessibility of the columns (#608)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_phone", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-conversation-phone-e2e-conversation-phone",
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
      NODE_OPTIONS: [
        "fake-google.mjs",
        "fake-mistral.mjs",
        "fake-reference-data.mjs",
      ]
        .map((fake) => `--import=${path.resolve("e2e/support", fake)}`)
        .join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("phone: the conversation fills the screen; the Fiche and a Section open full screen over it and close with ✕", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: server.origin,
      locale: "en-US",
    });
    const page = await context.newPage();
    const profileId = await withProfile(page, { width: 375, height: 812 });
    await page.goto(`/profils/${profileId}`);

    const box = (await conversation(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(375 - 2 * 24);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    // The Fiche is closed on a phone: it is not beside the conversation.
    await expect(ficheOf(page)).toHaveCount(0);

    // The Fiche opens over the conversation, full screen, the page behind out of reach; ✕ closes it.
    await ficheButton(page).click();
    await expect(ficheOf(page)).toBeVisible();
    const sheet = (await ficheOf(page).boundingBox())!;
    expect([sheet.x, sheet.y, sheet.width, sheet.height]).toEqual([
      0, 0, 375, 812,
    ]);
    await expect(page.locator("main")).toHaveAttribute("inert", "");
    await ficheOf(page).getByRole("button", { name: texts.close }).click();
    await expect(ficheOf(page)).toHaveCount(0);
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");

    // A Section opens in the Work Pane, full screen too; ✕ returns to the Profile.
    await ficheButton(page).click();
    await ficheOf(page)
      .getByRole("link", { name: fr.profilePage.sections.gerer, exact: true })
      .click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}/gerer`);
    const pane = page.getByRole("complementary", {
      name: fr.profilePage.sections.gerer,
    });
    const paneBox = (await pane.boundingBox())!;
    expect([paneBox.x, paneBox.y, paneBox.width, paneBox.height]).toEqual([
      0, 0, 375, 812,
    ]);
    await pane.getByRole("button", { name: texts.close }).click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}`);
    await expect(pane).toHaveCount(0);
    // The Fiche it was opened from is under it, still open: ✕ closes it too.
    await ficheOf(page).getByRole("button", { name: texts.close }).click();
    await expect(ficheOf(page)).toHaveCount(0);

    // The Sidebar stays a drawer: a dialog opened from the Menu button, not a column.
    await page
      .getByRole("button", { name: fr.sidebar.menu, exact: true })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByRole("navigation", { name: fr.sidebar.label }),
    ).toBeVisible();
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.width).toBeLessThan(375);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await context.close();
  });

  test("wide screen: each column is a named region, the Tab order runs from the conversation to the Fiche, replies are announced", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: server.origin,
      locale: "en-US",
    });
    const page = await context.newPage();
    const profileId = await withProfile(page, { width: 1600, height: 1000 });
    await page.goto(`/profils/${profileId}`);

    await expect(conversation(page)).toBeVisible();
    await expect(ficheOf(page)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: fr.sidebar.label }).first(),
    ).toBeVisible();

    // Replies are announced as they were: the message list is a polite live region.
    await expect(
      conversation(page).getByRole("list", {
        name: fr.coachPanel.messagesLabel,
      }),
    ).toHaveAttribute("aria-live", "polite");

    // Tab order: from the box in the conversation, the next focusable thing past it is in the Fiche, never before it.
    const order = await page.evaluate(() => {
      const conv = document.querySelector(".page-conversation")!;
      const fiche = document.querySelector(".fiche")!;
      return Boolean(
        conv.compareDocumentPosition(fiche) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(order).toBe(true);
    await conversation(page)
      .getByRole("textbox", { name: fr.coachPanel.messageLabel })
      .focus();
    let reached = false;
    for (let i = 0; i < 15 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() =>
        Boolean(document.activeElement?.closest(".fiche")),
      );
    }
    expect(reached).toBe(true);

    // Focus enters the Work Pane when a Section opens, and returns to its opener when it closes.
    const section = ficheOf(page).getByRole("link", {
      name: fr.profilePage.sections.gerer,
      exact: true,
    });
    await section.click();
    const pane = page.getByRole("complementary", {
      name: fr.profilePage.sections.gerer,
    });
    await expect(
      pane.getByRole("heading", {
        level: 2,
        name: fr.profilePage.sections.gerer,
      }),
    ).toBeFocused();
    await expect(pane.getByRole("button", { name: texts.close })).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .include(".page-conversation")
      .include(".fiche")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
    await pane.getByRole("button", { name: texts.close }).click();
    await expect(pane).toHaveCount(0);
    await expect(section).toBeFocused();
    await context.close();
  });
});
