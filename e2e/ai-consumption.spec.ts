import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
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

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants `role` to the account with `email` on the Administrateurs page. */
async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles[role] }));
}

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

  test("Support sees the failures and warnings per Failure Reason on Consommation IA and on a Tool's page, never a technical reason (#262)", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("reasons-support");
    const supportPage = await personPage(browser, support);
    await grant(page, support, "support");
    // The Guardrails' AI check of this question gets a 503 (fake-mistral.mjs): a failed call, provider_unavailable.
    await page.goto("/admin/consommation-ia");
    await askAssistant(page, `E2E_GUARDRAIL_DOWN Combien ? ${Date.now()}`);

    const reasons = supportPage.getByRole("table", { name: admin.aiUsage.reasonsCaption });
    const unavailable = reasons.getByRole("row").filter({ hasText: "provider_unavailable" });
    // Recorded just after the call failed: the report may need a reload to count it.
    await supportPage.goto("/admin/consommation-ia");
    await expect(async () => {
      await supportPage.reload();
      await expect(unavailable).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(supportPage.getByRole("heading", { level: 2, name: admin.aiUsage.reasonsTitle })).toBeVisible();
    await expect(reasons.getByRole("columnheader")).toHaveText([admin.aiUsage.code, admin.aiUsage.reason, admin.aiUsage.outcome, admin.aiUsage.calls]);
    await expect(unavailable.getByRole("cell")).toHaveText(["provider_unavailable", fr.failureReasons.provider_unavailable, admin.aiMessages.outcomes.failed, /^\d+$/]);
    const byTask = supportPage.getByRole("table", { name: admin.aiUsage.reasonsByTaskCaption }).getByRole("row").filter({ hasText: admin.aiUsage.tasks.guardrail });
    await expect(byTask.filter({ hasText: "provider_unavailable" })).toBeVisible();
    const byModel = supportPage.getByRole("table", { name: admin.aiUsage.reasonsByModelCaption }).getByRole("row").filter({ hasText: "mistral" });
    await expect(byModel.filter({ hasText: "provider_unavailable" }).first()).toBeVisible();

    // Mistral's page: the same counts over 30 days, and the failed call says its reason's wording.
    await supportPage.goto("/admin/outils/mistral");
    const toolReasons = supportPage.getByRole("table", { name: tr(admin.tools.reasonsCaption, { name: "Mistral AI" }) });
    await expect(toolReasons.getByRole("row").filter({ hasText: "provider_unavailable" })).toContainText(fr.failureReasons.provider_unavailable);
    const calls = supportPage.getByRole("table", { name: tr(admin.tools.callsCaption, { name: "Mistral AI" }) });
    await expect(calls.getByRole("row").filter({ hasText: "guardrail · " }).filter({ hasText: fr.failureReasons.provider_unavailable }).first()).toContainText(
      `${admin.tools.failed} · ${fr.failureReasons.provider_unavailable}`,
    );

    // Codes and wording only: no technical reason anywhere on these pages.
    for (const path of ["/admin/consommation-ia", "/admin/outils/mistral", "/admin/outils"]) {
      await supportPage.goto(path);
      const text = await supportPage.getByRole("main").innerText();
      for (const technical of ["AiProviderError", "upstream unavailable", admin.aiMessages.why]) expect(text, path).not.toContain(technical);
    }
  });

  test("the counts per Failure Reason grow by exactly the failed calls made, on Consommation IA and on the Tool's page (#262)", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const reasonCount = async (path: string, caption: string) => {
      await page.goto(path);
      const row = page.getByRole("table", { name: caption }).getByRole("row").filter({ hasText: "rate_limited" });
      if ((await row.count()) === 0) return 0;
      return Number(await row.first().getByRole("cell").last().innerText());
    };
    const toolCaption = tr(admin.tools.reasonsCaption, { name: "Mistral AI" });
    const beforeReport = await reasonCount("/admin/consommation-ia", admin.aiUsage.reasonsCaption);
    const beforeTool = await reasonCount("/admin/outils/mistral", toolCaption);

    // Two Candidates each talk to the Coach once: the Guardrails' AI check is refused (429) once per message.
    // No other test makes a call fail as rate_limited, so specs running alongside do not race the count.
    for (const prefix of ["reasons-count-a", "reasons-count-b"]) {
      const candidate = await personPage(browser, newAddress(prefix));
      const talked = await candidate.request.post("/api/coach", { headers: { origin }, data: { message: "E2E_GUARDRAIL_RATE_LIMITED Comment relancer Acme ?" } });
      expect(talked.status(), await talked.text()).toBe(200);
    }

    await expect(async () => {
      expect(await reasonCount("/admin/consommation-ia", admin.aiUsage.reasonsCaption)).toBe(beforeReport + 2);
    }).toPass();
    await expect(async () => {
      expect(await reasonCount("/admin/outils/mistral", toolCaption)).toBe(beforeTool + 2);
    }).toPass();
  });
});
