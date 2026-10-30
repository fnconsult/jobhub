import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #231: Eval Cases and Eval Runs (ADR-0023). Driven through the Back Office: a Playbook's page
// (/admin/playbooks/<id>: Eval Cases and Eval Runs), /admin/playbooks (the AI Coach's own Eval Cases),
// /admin/evaluations/<run id>, and through AI Usage.
// The AI is faked inside the server (fake-mistral.mjs): the AI judge scores a reply 8 out of 10 (80 / 100),
// 2 when the criteria hold "E2E_JUDGE_LOW"; the AI Coach consults the Playbook Agents a message lists
// after "E2E_CONSULT=".
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const playbooks = admin.coachingPlaybooks;
const evals = admin.evals;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "eval-runs-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles[role] }));
}

const notice = (page: Page) => page.getByRole("main").getByRole("status");
const alert = (page: Page) => page.getByRole("main").getByRole("alert");

/** A Playbook editor creates a playbook (version 1, not validated) and lands on its page. */
async function createPlaybook(page: Page, id: string, title: string) {
  await page.goto("/admin/playbooks");
  await page.getByLabel(playbooks.fields.id).fill(id);
  await page.getByLabel(playbooks.fields.content).fill(`# ${title}\n\n**R1. Visez le haut de la fourchette.** [S24]`);
  await page.getByLabel(playbooks.fields.model).selectOption({ index: 0 });
  await page.getByLabel(playbooks.fields.effort).selectOption("high");
  await page.getByLabel(playbooks.fields.consultWhen).fill("Quand le candidat parle de son salaire.");
  await page.getByRole("button", { name: playbooks.create.submit }).click();
  await expect(notice(page)).toHaveText(playbooks.notices.created);
}

interface CaseInput {
  title: string;
  context?: string;
  message: string;
  criteria: string;
  inView?: { kind: string; text: string };
}

async function addCase(page: Page, id: string, input: CaseInput) {
  await page.goto(`/admin/playbooks/${id}`);
  await page.locator("#new-case-title").fill(input.title);
  await page.locator("#new-case-context").fill(input.context ?? "Le candidat s'appelle Paul (prénom seulement). Il a 55 ans et vise un poste de DAF.");
  await page.locator("#new-case-message").fill(input.message);
  if (input.inView) {
    await page.locator("#new-case-in-view-kind").selectOption(input.inView.kind);
    await page.locator("#new-case-in-view-text").fill(input.inView.text);
  }
  await page.locator("#new-case-criteria").fill(input.criteria);
  await page.getByRole("button", { name: evals.cases.addButton }).click();
  await expect(notice(page)).toHaveText(playbooks.notices.caseAdded);
}

/** Starts an Eval Run with the form as it is, and waits for its page. */
async function startRun(page: Page) {
  await page.getByRole("button", { name: evals.runs.startButton }).click();
  await expect(page).toHaveURL(/\/admin\/evaluations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(evals.title);
}

test.describe("Eval Cases of a Coaching Playbook", () => {
  test("a Playbook editor writes, changes and removes them in French, without validation; they belong to the playbook, not to a version; every change is in the Journal", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const editorEmail = newAddress("eval-case-editor");
    const editor = await personPage(browser, editorEmail);
    await grant(page, editorEmail, "playbook-editor");
    const id = `e2e-cas-${unique()}`;
    await createPlaybook(editor, id, "Négocier son salaire");
    await addCase(editor, id, {
      title: "Cas de négociation",
      message: "On m'offre 85 k€, comment négocier ?",
      criteria: "La réponse conseille de viser le haut de la fourchette.",
      inView: { kind: "job_offer", text: "DAF H/F chez Acme Industrie, Lyon, 80 à 90 k€." },
    });

    // Shown with its author and what makes it: a fictional Coach context, a message, an item In view and criteria.
    const article = editor.getByRole("article").filter({ hasText: "Cas de négociation" });
    await expect(article).toContainText(tr(evals.cases.writtenBy, { author: editorEmail, date: "" }).trim().split(",")[0]);
    await expect(article).toContainText("Le candidat s'appelle Paul");
    await expect(article).toContainText("On m'offre 85 k€, comment négocier ?");
    await expect(article).toContainText(`${evals.cases.inViewKinds.job_offer} : DAF H/F chez Acme Industrie`);
    await expect(article).toContainText("La réponse conseille de viser le haut de la fourchette.");
    // Nothing to validate: there is no validation step for a case.
    await expect(article.getByRole("button", { name: /valid/i })).toHaveCount(0);

    // Evaluated and validated, version 1 gives way to a version 2 on change; the Eval Cases stay with the playbook.
    await editor.getByRole("button", { name: evals.runs.startButton }).click();
    await expect(editor).toHaveURL(/\/admin\/evaluations\//);
    await page.goto(`/admin/playbooks/${id}`);
    await page.getByLabel(playbooks.detail.validatorName).fill("Validateur");
    await page.getByRole("button", { name: tr(playbooks.detail.validate, { version: "1" }) }).click();
    await expect(notice(page)).toHaveText(tr(playbooks.notices.validated, { version: "1" }));
    await editor.goto(`/admin/playbooks/${id}`);
    await editor.getByLabel(playbooks.fields.content).fill("# Négocier son salaire\n\n**R1. Visez le haut de la fourchette, preuves à l'appui.** [S24]");
    await editor.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(notice(editor)).toHaveText(tr(playbooks.notices.saved, { version: "2" }));
    await expect(editor.getByRole("heading", { name: "Cas de négociation" })).toHaveCount(1);
    await editor.goto(`/admin/playbooks/${id}?version=1`);
    await expect(editor.getByRole("heading", { name: "Cas de négociation" })).toHaveCount(1);

    // Changed, then removed.
    await article.getByText(evals.cases.edit).click();
    // Every field of the edit form has its label (ADR-0009, WCAG 2.1 AA), the Title too: no other element shares its id.
    await expect(article.getByRole("textbox", { name: evals.cases.fields.title, exact: true })).toHaveValue("Cas de négociation");
    await expect(editor.getByRole("article", { name: "Cas de négociation", exact: true })).toHaveCount(1);
    await article.getByLabel(evals.cases.fields.criteria).fill("La réponse conseille de demander un variable.");
    await article.getByRole("button", { name: evals.cases.save }).click();
    await expect(notice(editor)).toHaveText(playbooks.notices.caseSaved);
    await expect(editor.getByRole("article").filter({ hasText: "Cas de négociation" })).toContainText("La réponse conseille de demander un variable.");
    await editor.getByRole("article").filter({ hasText: "Cas de négociation" }).getByText(evals.cases.edit).click();
    await editor.getByRole("article").filter({ hasText: "Cas de négociation" }).getByRole("button", { name: evals.cases.remove }).click();
    await expect(notice(editor)).toHaveText(playbooks.notices.caseRemoved);
    await expect(editor.getByRole("heading", { name: "Cas de négociation" })).toHaveCount(0);
    await expect(editor.getByText(evals.cases.none)).toBeVisible();

    // Added, changed, removed: each in the Back Office Audit (the Journal), by whom, naming the case.
    await page.goto("/admin/journal?section=eval_cases");
    const rows = page.getByRole("row").filter({ hasText: id });
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(admin.journal.actions.removed);
    await expect(rows.nth(1)).toContainText(admin.journal.actions.updated);
    await expect(rows.nth(2)).toContainText(admin.journal.actions.added);
    for (const index of [0, 1, 2]) await expect(rows.nth(index)).toContainText(editorEmail);
    await expect(rows.nth(2)).toContainText("Cas de négociation");
  });

  test("Support reads them but cannot write one or start a run", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const id = `e2e-cas-ro-${unique()}`;
    await createPlaybook(page, id, "Lecture seule");
    await addCase(page, id, { title: "Cas lisible", message: "Bonjour", criteria: "La réponse est polie." });
    const supportEmail = newAddress("eval-support");
    const support = await personPage(browser, supportEmail);
    await grant(page, supportEmail, "support");

    await support.goto(`/admin/playbooks/${id}`);
    await expect(support.getByRole("heading", { name: "Cas lisible" })).toBeVisible();
    await expect(support.getByRole("button", { name: evals.cases.addButton })).toBeDisabled();
    await expect(support.getByRole("button", { name: evals.runs.startButton })).toBeDisabled();
  });
});

test.describe("Eval Runs of a Coaching Playbook", () => {
  test("a run plays the AI Coach's whole reply made to consult the playbook, records each case, the score, cost and response time, and keeps the text it played", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const editorEmail = newAddress("eval-run-editor");
    const editor = await personPage(browser, editorEmail);
    await grant(page, editorEmail, "playbook-editor");
    const id = `e2e-run-${unique()}`;
    await createPlaybook(editor, id, "Négocier un salaire");
    await addCase(editor, id, {
      title: "Cas joué",
      message: "On m'offre 85 k€, comment négocier ?",
      criteria: "La réponse conseille de viser le haut de la fourchette.",
    });
    await addCase(editor, id, { title: "Cas raté", message: "Et le variable ?", criteria: "E2E_JUDGE_LOW La réponse parle du variable." });
    await editor.goto(`/admin/playbooks/${id}`);
    await expect(editor.getByText(evals.runs.none)).toBeVisible();
    await startRun(editor);
    const runUrl = editor.url();

    // What it played, and on what.
    await expect(editor.getByText(tr(evals.run.subjects.coaching_playbook, { playbook: "Négocier un salaire", version: "1" }))).toBeVisible();
    await expect(editor.getByText(editorEmail)).toBeVisible();
    await expect(editor.getByText(evals.runs.asSaved).first()).toBeVisible();
    // The AI Coach's whole reply was made to consult this playbook (the others served as they are): it names the playbook among those consulted.
    const played = editor.getByRole("region", { name: "Cas joué" });
    await expect(played.getByText(`${id}`, { exact: false }).first()).toBeVisible();
    await expect(played.getByText("E2E : la réponse remplit les critères.")).toBeVisible();
    await expect(played).toContainText(tr(evals.runs.scoreValue, { score: "80" }));
    await expect(played).toContainText("€");
    await expect(played).toContainText(/\d+(,\d+)? s/);
    // The other case is scored low; the overall score is the mean: (80 + 20) / 2.
    await expect(editor.getByRole("region", { name: "Cas raté" })).toContainText(tr(evals.runs.scoreValue, { score: "20" }));
    await expect(editor.getByRole("region", { name: "Cas raté" }).getByText("E2E : la réponse ne remplit pas les critères.")).toBeVisible();
    const overall = editor.locator("dl").first();
    await expect(overall).toContainText(tr(evals.runs.scoreValue, { score: "50" }));
    await expect(overall).toContainText("€");
    // The judge is fixed by Jobbbox: it is named, not chosen.
    await expect(editor.getByText(evals.run.judge)).toBeVisible();

    // The run is listed, dated, with its score, cost and response time.
    await editor.goto(`/admin/playbooks/${id}`);
    const runRow = editor.getByRole("table", { name: evals.runs.caption }).getByRole("row").nth(1);
    await expect(runRow.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    await expect(runRow).toContainText(tr(evals.runs.scoreValue, { score: "50" }));
    await expect(runRow).toContainText("€");

    // The case changes afterwards; the run keeps the text it played.
    await editor.getByRole("article").filter({ hasText: "Cas joué" }).getByText(evals.cases.edit).click();
    await editor.getByRole("article").filter({ hasText: "Cas joué" }).getByLabel(evals.cases.fields.message).fill("Un tout autre message.");
    await editor.getByRole("article").filter({ hasText: "Cas joué" }).getByRole("button", { name: evals.cases.save }).click();
    await expect(notice(editor)).toHaveText(playbooks.notices.caseSaved);
    await editor.goto(runUrl);
    await expect(editor.getByText("On m'offre 85 k€, comment négocier ?")).toBeVisible();
    await expect(editor.getByText("Un tout autre message.")).toHaveCount(0);
  });

  test("it needs at least one Eval Case; a Candidate never reaches a run", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const id = `e2e-run-vide-${unique()}`;
    await createPlaybook(page, id, "Sans cas");
    await expect(page.getByRole("button", { name: evals.runs.startButton })).toBeDisabled();

    await addCase(page, id, { title: "Un cas", message: "Bonjour", criteria: "La réponse est polie." });
    await startRun(page);
    const runUrl = new URL(page.url()).pathname;
    const candidate = await personPage(browser, newAddress("eval-candidate"));
    expect((await candidate.goto(runUrl))?.status()).toBe(404);
  });

  test("the AI Coach's reply consults the playbook being evaluated; its calls are on the eval task in AI Usage", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const id = `e2e-conseil-${unique()}`;
    await createPlaybook(page, id, "Consultation");
    await addCase(page, id, { title: "Consulte", message: `Mon salaire ? E2E_CONSULT=${id}`, criteria: "La réponse reprend l'avis du playbook." });
    await page.goto(`/admin/playbooks/${id}`);
    await startRun(page);
    await expect(page.getByRole("region", { name: "Consulte" })).toContainText(id);

    // AI Usage counts them on their own task.
    await expect(async () => {
      await page.goto("/admin/consommation-ia");
      await expect(page.getByRole("table", { name: admin.aiUsage.byTaskCaption }).getByRole("row").filter({ hasText: admin.aiUsage.tasks.eval })).toBeVisible({ timeout: 1_000 });
    }).toPass();
  });

  test("models and efforts are compared by running a draft once per choice, on EU-resident models only, side by side with score, cost and response time", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const id = `e2e-compare-${unique()}`;
    await createPlaybook(page, id, "Comparer");
    await addCase(page, id, { title: "Un cas", message: `Mon salaire ? E2E_CONSULT=${id}`, criteria: "La réponse est utile." });
    await page.goto(`/admin/playbooks/${id}`);

    const models = page.getByLabel(evals.runs.model);
    const groups = await models.locator("optgroup").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("label") ?? ""));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group, group).not.toMatch(/api\.openai\.com|api\.anthropic\.com|api\.mistral\.ai|\.us-[a-z]+-\d/);
    // The same choices as the playbook's own model field: nothing the Back Office does not allow.
    const own = await page.getByLabel(playbooks.fields.model).first().locator("option").allTextContents();
    const offered = await models.locator("optgroup option").allTextContents();
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(own.length + groups.length);

    // Once as saved, then once with a model and an effort chosen.
    await startRun(page);
    await page.goto(`/admin/playbooks/${id}`);
    const choice = await models.locator("optgroup option").nth(1).getAttribute("value");
    await models.selectOption(choice!);
    await page.getByLabel(evals.runs.effort).selectOption("low");
    await startRun(page);
    await expect(page.getByText(evals.runs.tried).first()).toBeVisible();

    await page.goto(`/admin/playbooks/${id}`);
    const rows = page.getByRole("table", { name: evals.runs.caption }).getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText(evals.runs.tried);
    await expect(rows.nth(2)).toContainText(evals.runs.asSaved);
    for (const index of [1, 2]) {
      await expect(rows.nth(index)).toContainText(tr(evals.runs.scoreValue, { score: "80" }));
      await expect(rows.nth(index)).toContainText("€");
      await expect(rows.nth(index)).toContainText(/\d+(,\d+)? s/);
    }
  });

  test("a version is validated only after a run; the validator sees it beside the served version's run; a low score blocks nothing", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const editorEmail = newAddress("eval-validation-editor");
    const editor = await personPage(browser, editorEmail);
    await grant(page, editorEmail, "playbook-editor");
    const id = `e2e-valid-${unique()}`;
    await createPlaybook(editor, id, "Validation");
    await addCase(editor, id, { title: "Un cas", message: "Bonjour", criteria: "La réponse est polie." });
    const validate = async (page: Page, version: string, name: string) => {
      await page.getByLabel(playbooks.detail.validatorName).fill(name);
      await page.getByRole("button", { name: tr(playbooks.detail.validate, { version }) }).click();
    };

    // Version 1: refused without a run, validated after one.
    await page.goto(`/admin/playbooks/${id}`);
    await validate(page, "1", "Validateur");
    await expect(alert(page)).toHaveText(tr(playbooks.notices.no_eval_run, { version: "1" }));
    await editor.goto(`/admin/playbooks/${id}`);
    await startRun(editor);
    await page.goto(`/admin/playbooks/${id}`);
    await validate(page, "1", "Validateur");
    await expect(notice(page)).toHaveText(tr(playbooks.notices.validated, { version: "1" }));

    // Version 2 (changed after the run: a run on version 1 does not count for it), played with a case the judge scores low.
    await editor.goto(`/admin/playbooks/${id}`);
    await editor.getByLabel(playbooks.fields.content).fill("# Validation\n\n**R1. Autre règle.** [S24]");
    await editor.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(notice(editor)).toHaveText(tr(playbooks.notices.saved, { version: "2" }));
    await page.goto(`/admin/playbooks/${id}`);
    await expect(page.getByText(evals.validation.noRunOnLatest)).toBeVisible();
    await validate(page, "2", "Validateur");
    await expect(alert(page)).toHaveText(tr(playbooks.notices.no_eval_run, { version: "2" }));

    await addCase(editor, id, { title: "Cas bas", message: "Autre ?", criteria: "E2E_JUDGE_LOW Elle fait tout." });
    await editor.goto(`/admin/playbooks/${id}`);
    await startRun(editor);
    await page.goto(`/admin/playbooks/${id}`);
    await expect(page.getByText(tr(evals.validation.onLatest, { version: "2" }))).toBeVisible();
    // The e2e server serves the latest version (JOBHUB_TARGET=e2e), so the served version is the one evaluated: both lines show a run.
    await expect(page.getByText(tr(evals.validation.onServed, { version: "2" }))).toBeVisible();
    await expect(page.getByText(evals.validation.noScoreBlocks)).toBeVisible();
    const beside = page.locator("dl").filter({ hasText: tr(evals.validation.onLatest, { version: "2" }) });
    await expect(beside).toContainText(tr(evals.runs.scoreValue, { score: "50" }));
    await expect(beside.getByRole("link", { name: evals.runs.open })).toHaveCount(2);
    await validate(page, "2", "Validateur");
    await expect(notice(page)).toHaveText(tr(playbooks.notices.validated, { version: "2" }));
  });
});

test.describe("The AI Coach's own Eval Cases", () => {
  test("they live in code: an Administrator plays them on the AI Coach as shipped, without a way to edit them", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/playbooks");
    const section = page.locator("section#ai-coach-evals");
    await expect(section.getByRole("heading", { name: evals.aiCoach.title })).toBeVisible();
    await expect(section.getByLabel(evals.cases.fields.title)).toHaveCount(0);
    await section.getByRole("button", { name: evals.aiCoach.start }).click();
    await expect(page).toHaveURL(/\/admin\/evaluations\/[0-9a-f-]{36}$/);
    await expect(page.getByText(evals.run.subjects.ai_coach)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vouvoie un candidat qui le tutoie" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "N'invente aucun chiffre" })).toBeVisible();
    await expect(page.getByText(tr(evals.runs.scoreValue, { score: "80" })).first()).toBeVisible();

    // A Candidate never reaches the Back Office.
    const candidate = await personPage(browser, newAddress("eval-ai-coach-candidate"));
    expect((await candidate.goto("/admin/playbooks"))?.status()).toBe(404);
  });
});
