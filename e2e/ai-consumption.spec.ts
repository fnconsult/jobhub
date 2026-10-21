import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #218 (and #259, the Outcome and Failure Reason of each call): the Back Office's AI consumption report (Consommation IA) counts every AI
// call, and the AI Message Log (Journaux IA) keeps what each said for 30 days, for
// super-admins only, every log opened written to the Journal. The AI is faked inside the
// server (fake-mistral.mjs); the Back Office Assistant makes the call here, under its own task.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const assistantTexts = fr.backOfficeAssistant;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const origin = process.env.E2E_WEB_ORIGIN!;
const SUPER_ADMIN = "ai-office@e2e.jobbbox.test";
/** The Provider Secret the e2e server runs with (playwright.config.ts): it must never be stored. */
const MISTRAL_KEY = "e2e-mistral-key";

const assistant = (page: Page) => page.getByRole("complementary", { name: assistantTexts.title });

/** Asks the Back Office Assistant `text` and waits for its reply: one AI call (task back_office_assistant). */
async function askAssistant(page: Page, text: string) {
  await page.getByRole("button", { name: assistantTexts.open, exact: true }).click();
  await assistant(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await assistant(page).getByRole("button", { name: fr.coachPanel.send }).click();
  // Its reply: an item after the question, once « thinking » is gone. Not a count: a failed Guardrail check
  // (E2E_GUARDRAIL_*) may add a notice of its own beside the reply.
  const items = assistant(page).getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li");
  await expect(items.filter({ hasText: text })).toHaveCount(1);
  await expect(items.last()).not.toContainText(text);
  await expect(items.last()).not.toContainText(assistantTexts.thinking);
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
    await expect(rows.first()).toContainText(admin.aiMessages.outcomes.ok);
    await expect(page.getByRole("table", { name: admin.aiMessages.caption })).not.toContainText(question);
    // Filtered by Outcome and Failure Reason too (#259), every filter kept in the URL: no failed call here.
    await page.getByLabel(admin.aiMessages.result).selectOption("failed");
    await page.getByLabel(admin.aiMessages.reason).selectOption("provider_unavailable");
    await page.getByRole("button", { name: admin.aiMessages.apply }).click();
    await expect(page).toHaveURL(/outcome=failed/);
    await expect(page).toHaveURL(/reason=provider_unavailable/);
    await expect(page.getByText(admin.aiMessages.none)).toBeVisible();
    await page.getByLabel(admin.aiMessages.result).selectOption("ok");
    await page.getByLabel(admin.aiMessages.reason).selectOption("");
    await page.getByRole("button", { name: admin.aiMessages.apply }).click();
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

  test("a failed AI call is listed as failed with its Failure Reason; its log says « Pourquoi », then the technical reason (#259)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/journaux-ia");
    // The Guardrails' AI check of this question gets a 503 (fake-mistral.mjs): that call fails, the question goes through.
    await askAssistant(page, `E2E_GUARDRAIL_DOWN Bonjour ${Date.now()}`);

    await page.getByLabel(admin.aiMessages.email).fill(SUPER_ADMIN);
    await page.getByLabel(admin.aiMessages.task).selectOption("guardrail");
    await page.getByLabel(admin.aiMessages.result).selectOption("failed");
    await page.getByLabel(admin.aiMessages.reason).selectOption("provider_unavailable");
    const rows = page.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: SUPER_ADMIN });
    // The call is recorded just after it failed, never on its way: the list may need asking again.
    await expect(async () => {
      await page.getByRole("button", { name: admin.aiMessages.apply }).click();
      await expect(rows.first()).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(page).toHaveURL(/outcome=failed/);
    await expect(page).toHaveURL(/reason=provider_unavailable/);
    await expect(rows.first()).toContainText(`${admin.aiMessages.outcomes.failed} · ${fr.failureReasons.provider_unavailable}`);
    await expect(rows.first()).not.toContainText(admin.aiMessages.notSent);

    await rows.first().getByRole("link", { name: admin.aiMessages.open }).click();
    const why = page.getByRole("region", { name: admin.aiMessages.why });
    await expect(why).toContainText(fr.failureReasons.provider_unavailable);
    const technical = why.getByRole("definition");
    await expect(technical.filter({ hasText: "AiProviderError" })).toBeVisible();
    await expect(technical.filter({ hasText: /^503$/ })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(MISTRAL_KEY);
  });

  test("a technical reason holding an API key, an email address or a long text is stored scrubbed, redacted and cut (#259)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/journaux-ia");
    // The Guardrails' AI check of this question is refused by a 400 echoing the key, an email address and a long text.
    await askAssistant(page, `E2E_GUARDRAIL_ECHO Bonjour ${Date.now()}`);

    await page.goto("/admin/journaux-ia");
    await page.getByLabel(admin.aiMessages.email).fill(SUPER_ADMIN);
    await page.getByLabel(admin.aiMessages.task).selectOption("guardrail");
    await page.getByLabel(admin.aiMessages.reason).selectOption("provider_rejected");
    const rows = page.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: SUPER_ADMIN });
    await expect(async () => {
      await page.getByRole("button", { name: admin.aiMessages.apply }).click();
      await expect(rows.first()).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await rows.first().getByRole("link", { name: admin.aiMessages.open }).click();

    const why = page.getByRole("region", { name: admin.aiMessages.why });
    await expect(why).toContainText(fr.failureReasons.provider_rejected);
    const text = (await why.innerText()).replace(/\s+/g, " ");
    expect(text).toContain("invalid key");
    expect(text).not.toContain(MISTRAL_KEY);
    expect(text).not.toContain("echo.person@example.fr");
    // Cut: the end of the long text is gone.
    expect(text).not.toContain("END_OF_ECHO");
    expect(text.length).toBeLessThan(900);
  });

  test("the Candidate's data export holds each failed call's Failure Reason code and wording, never its technical reason (#259)", async ({ page }) => {
    const email = newAddress("failure-export");
    await signInWithMagicLink(page, email);
    const talked = await page.request.post("/api/coach", { headers: { origin }, data: { message: "E2E_GUARDRAIL_DOWN Comment relancer Acme ?" } });
    expect(talked.status(), await talked.text()).toBe(200);

    await page.goto("/compte/donnees");
    const section = page.getByRole("region", { name: fr.accountData.title });
    let failed: Record<string, unknown> | undefined;
    await expect(async () => {
      const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
      const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
      failed = exported.aiMessageLog.find((log: { outcome: string }) => log.outcome === "failed");
      expect(failed).toBeTruthy();
    }).toPass();
    expect(failed).toMatchObject({ task: "guardrail", outcome: "failed", reason: { code: "provider_unavailable", wording: fr.failureReasons.provider_unavailable } });
    const raw = JSON.stringify(failed);
    expect(raw).not.toContain("AiProviderError");
    expect(raw).not.toContain("technicalReason");
    expect(raw).not.toContain("503");
  });
});
