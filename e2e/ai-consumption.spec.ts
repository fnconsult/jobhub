import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";

// Issue #218: the Back Office's AI consumption report (Consommation IA) counts every AI
// call, and the AI Message Log (Journaux IA) keeps what each said for 30 days, for
// super-admins only, every log opened written to the Journal. The AI is faked inside the
// server (fake-mistral.mjs); the Back Office Assistant makes the call here, under its own task.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const assistantTexts = fr.backOfficeAssistant;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "ai-office@e2e.jobbbox.test";
/** The Provider Secret the e2e server runs with (playwright.config.ts): it must never be stored. */
const MISTRAL_KEY = "e2e-mistral-key";

const assistant = (page: Page) => page.getByRole("complementary", { name: assistantTexts.title });

/** Asks the Back Office Assistant `text` and waits for its reply: one AI call (task back_office_assistant). */
async function askAssistant(page: Page, text: string) {
  await page.getByRole("button", { name: assistantTexts.open, exact: true }).click();
  await assistant(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await assistant(page).getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(assistant(page).getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li")).toHaveCount(2);
}

test.describe("AI consumption and AI message logs", () => {
  test("a super-admin sees each AI call in the report, then reads what it said; the view goes to the Journal", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/consommation-ia");
    const question = `Combien coûte l'IA ? ${Date.now()} ${MISTRAL_KEY}`;
    await askAssistant(page, question);

    // The report: in the Plateforme group, over the last 30 days by default, with the Back Office Assistant's task counted.
    // The call is recorded just after its reply, never on its way: the report may need a reload to show it.
    await page.goto("/admin/consommation-ia");
    const assistantRow = page.getByRole("table", { name: admin.aiUsage.byTaskCaption }).getByRole("row").filter({ hasText: admin.aiUsage.tasks.back_office_assistant });
    await expect(async () => {
      await page.reload();
      await expect(assistantRow).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(page).toHaveTitle(`${admin.aiUsage.title} · ${admin.title}`);
    await expect(page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.aiUsage })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel(admin.aiUsage.period)).toHaveValue("30d");
    await expect(page.getByRole("table", { name: admin.aiUsage.byModelCaption }).getByRole("row").filter({ hasText: "mistral" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: admin.aiUsage.coachCostLink })).toHaveAttribute("href", "/admin/cout-coach");
    // Another period, month by month.
    await page.getByLabel(admin.aiUsage.period).selectOption("12m");
    await page.getByRole("button", { name: admin.aiUsage.show }).click();
    await expect(page).toHaveURL(/periode=12m/);
    await expect(page.getByRole("heading", { name: admin.aiUsage.byMonthTitle })).toBeVisible();

    // The message log: found by the Candidate's email and the task, opened, its text shown, the key scrubbed.
    await page.goto("/admin/journaux-ia");
    await page.getByLabel(admin.aiMessages.email).fill(SUPER_ADMIN);
    await page.getByLabel(admin.aiMessages.task).selectOption("back_office_assistant");
    await page.getByRole("button", { name: admin.aiMessages.apply }).click();
    const rows = page.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: SUPER_ADMIN });
    await expect(rows.first()).toContainText(admin.aiUsage.tasks.back_office_assistant);
    await expect(page.getByRole("table", { name: admin.aiMessages.caption })).not.toContainText(question);
    await rows.first().getByRole("link", { name: admin.aiMessages.open }).click();
    await expect(page.getByRole("status")).toHaveText(admin.aiMessages.audited);
    await expect(page.getByRole("main")).toContainText(question.replace(MISTRAL_KEY, "[redacted]"));
    await expect(page.getByRole("main")).not.toContainText(MISTRAL_KEY);
    const logUrl = page.url();

    // Who viewed which log, when.
    await page.goto("/admin/journal?section=ai_messages");
    const entry = page.getByRole("row").filter({ hasText: logUrl.split("/").pop()! });
    await expect(entry.first()).toContainText(admin.journal.actions.viewed);
    await expect(entry.first()).toContainText(SUPER_ADMIN);
  });
});
