import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { conversationOf, toConversation } from "./support/conversation";

// Issue #713 (ADR-0077): Coach Actions, the AI Coach calling code of the app during a reply. The catalogue shipped is
// empty until each group's ticket, so in the running app the AI Coach is offered no tool whatever the switch says: with
// COACH_ACTIONS_ENABLED off (the default) or on, a reply is the one it was before Coach Actions, and the Routes locales
// Tools in Outils say whether the switch is on. The calls themselves (a fake Coach Action of each kind, scope, allow-list,
// Provenance, external_api_usage, AI Message Log) are in ai-actions-coach.spec.ts. The AI is faked inside the server
// (fake-mistral.mjs): a message holding `E2E_COACH_TOOL=<name>:<json>` has the AI Coach call that tool when it was offered some.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.platformSettings;
const tools = admin.tools;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "coach-actions-office@e2e.jobbbox.test";
const ENABLED = "COACH_ACTIONS_ENABLED";
const ROUNDS = "COACH_TOOL_ROUNDS_MAX";
const GROUPS = 6;
/** A message asking the AI Coach to call a tool, and the plain reply it gets when it was offered none. */
const PLAIN = "Réponse sans outil";
const ASKING = `Où en est ma candidature ?\nE2E_COACH_TOOL=lire_candidature:{"id":"a1"}\nE2E_COACH_SAY=${PLAIN}`;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const row = (page: Page, name: string) => page.locator(`tr[data-setting="${name}"]`);
const messagesOf = (page: Page) => conversationOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li");

async function ask(page: Page, text: string) {
  const panel = conversationOf(page);
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(text);
  await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

/** Whatever happens, the other specs find the switch as the code leaves it: off. */
async function resetSettings() {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DELETE FROM platform_setting WHERE name = ANY($1::text[])", [[ENABLED, ROUNDS]]);
    await client.query("SELECT pg_notify('platform_settings_changed', '')");
  } finally {
    await client.end();
  }
}

test.describe("Coach Actions: the switch and the AI Coach's reply (#713)", () => {
  test.afterAll(resetSettings);

  test("off by default: Paramètres says so, Outils lists the six Routes locales Tools as disabled, and the AI Coach replies as before", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/parametres?tab=ia");
    // Under the AI tab, off and at two rounds, the code's defaults.
    await expect(row(page, ENABLED).getByRole("cell").nth(0)).toHaveText("false");
    await expect(row(page, ENABLED).getByRole("cell").nth(1)).toHaveText(texts.sources.default);
    await expect(row(page, ROUNDS).getByRole("cell").nth(0)).toHaveText("2");
    await expect(row(page, ROUNDS).getByRole("cell").nth(1)).toHaveText(texts.sources.default);

    await page.goto("/admin/outils");
    const table = page.getByRole("table", { name: tools.categories.local_routes });
    await expect(page.getByRole("heading", { level: 2, name: tools.categories.local_routes })).toBeVisible();
    const toolRows = table.getByRole("row").filter({ has: page.getByRole("rowheader") });
    await expect(toolRows).toHaveCount(GROUPS);
    for (let index = 0; index < GROUPS; index += 1) await expect(toolRows.nth(index)).toContainText(tools.statuses.disabled);

    // A Candidate's reply, asked to call a tool: no tool was offered, the reply is the plain one.
    await page.context().clearCookies();
    await signInWithMagicLink(page, newAddress("coach-actions-off"));
    await toConversation(page);
    await ask(page, ASKING);
    await expect(messagesOf(page)).toHaveCount(3);
    const reply = messagesOf(page).last();
    await expect(reply).toContainText(PLAIN);
    await expect(reply).not.toContainText("Résultat de l'outil");
    // Its Provenance holds the one `coaching` call: no `act` step.
    await expect(reply.locator(".provenance-line")).toContainText("Mistral Large");
  });

  test("switched on, with no Coach Action shipped yet the AI Coach is still offered no tool; the Routes locales Tools turn on; « Rétablir » turns them off again", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/parametres?tab=ia");
    const setting = row(page, ENABLED);
    await setting.getByRole("combobox", { name: tr(texts.newValue, { name: ENABLED }) }).selectOption("true");
    await setting.getByRole("button", { name: texts.save }).click();
    await expect(page.getByRole("status").filter({ hasText: ENABLED })).toHaveText(tr(texts.notices.saved, { name: ENABLED }));
    await expect(setting.getByRole("cell").nth(0)).toHaveText("true");
    await expect(setting.getByRole("cell").nth(1)).toContainText(SUPER_ADMIN);

    // A value out of COACH_TOOL_ROUNDS_MAX's bounds (0 to 4) is refused.
    const rounds = row(page, ROUNDS);
    await rounds.getByRole("textbox", { name: tr(texts.newValue, { name: ROUNDS }) }).fill("5");
    await rounds.getByRole("button", { name: texts.save }).click();
    await expect(page.getByRole("alert").filter({ hasText: ROUNDS })).toHaveText(tr(texts.notices.invalid, { name: ROUNDS, rule: tr(texts.rules.whole, { min: "0", max: "4" }) }));
    await expect(rounds.getByRole("cell").nth(0)).toHaveText("2");

    await page.goto("/admin/outils");
    const toolRows = page.getByRole("table", { name: tools.categories.local_routes }).getByRole("row").filter({ has: page.getByRole("rowheader") });
    await expect(toolRows).toHaveCount(GROUPS);
    for (let index = 0; index < GROUPS; index += 1) await expect(toolRows.nth(index)).not.toContainText(tools.statuses.disabled);

    // The switch is on, the catalogue empty: a Candidate's reply is still the plain one.
    const candidate = await page.context().browser()!.newContext({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "en-US" });
    const candidatePage = await candidate.newPage();
    try {
      await signInWithMagicLink(candidatePage, newAddress("coach-actions-on"));
      await toConversation(candidatePage);
      await ask(candidatePage, ASKING);
      await expect(messagesOf(candidatePage)).toHaveCount(3);
      await expect(messagesOf(candidatePage).last()).toContainText(PLAIN);
      await expect(messagesOf(candidatePage).last()).not.toContainText("Résultat de l'outil");
    } finally {
      await candidate.close();
    }

    await page.goto("/admin/parametres?tab=ia");
    await row(page, ENABLED).getByRole("button", { name: texts.restore }).click();
    await expect(page.getByRole("status").filter({ hasText: ENABLED })).toHaveText(tr(texts.notices.restored, { name: ENABLED }));
    await expect(row(page, ENABLED).getByRole("cell").nth(0)).toHaveText("false");

    // Both changes are in the Journal.
    await page.goto("/admin/journal?section=platform_settings");
    const entries = page.getByRole("row").filter({ hasText: ENABLED }).filter({ hasText: SUPER_ADMIN });
    await expect(entries.filter({ hasText: admin.journal.actions.updated })).toHaveCount(1);
    await expect(entries.filter({ hasText: admin.journal.actions.restored_to_default })).toHaveCount(1);
  });
});
