import { readdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";

// Issue #225: the Back Office's Coaching Playbooks section. A Playbook editor (granted by a super-admin
// on the Administrateurs page) creates and versions playbooks; another Administrator validates a
// version, naming themselves; changing a validated version makes a new one; a playbook is archived,
// never deleted; every step is in the Journal with a link to its version. The e2e server serves the
// latest versions (JOBHUB_TARGET=e2e), so the AI Coach consults what was just written: its fake
// (fake-mistral.mjs) consults the Playbook Agents a message lists after "E2E_CONSULT=", and prints its
// system prompt to the server log for "E2E_SHOW_CONTEXT#<tag>". ADR-0026: the AI tasks' Task Playbooks are
// listed apart and edited the same way; the fake reading a Job Offer holding "E2E_ECHO_RULES" echoes the last rule it was sent.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const playbooks = admin.coachingPlaybooks;
const evals = admin.evals;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "playbook-validator-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

const notice = (page: Page) => page.getByRole("main").getByRole("status");
const alert = (page: Page) => page.getByRole("main").getByRole("alert");

/** The system prompt the AI Coach was sent for a Candidate's message. */
async function coachPrompt(page: Page, message: string): Promise<string> {
  const show = showSystemPrompt();
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `${message} ${show}` } });
  expect(response.status(), await response.text()).toBe(200);
  return systemPromptShown(show);
}

test.describe("the Back Office's Coaching Playbooks", () => {
  test("a Playbook editor writes a playbook, another Administrator validates it, a change makes version 2, and each step is in the Journal", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const editorEmail = newAddress("playbook-editor");
    const editor = await personPage(browser, editorEmail);
    await grant(page, editorEmail, "playbook-editor");
    const id = `e2e-salaire-${unique()}`;

    // The editor's Back Office holds this section alone, under Coaching.
    await editor.goto("/admin");
    await expect(editor.getByRole("navigation", { name: admin.nav.label }).getByRole("link")).toHaveText([admin.nav.dashboard, admin.sections.coachingPlaybooks, admin.nav.account]);
    await editor.goto("/admin/playbooks");
    await expect(editor.getByRole("heading", { level: 1 })).toHaveText(playbooks.title);
    await expect(editor.getByRole("row").filter({ hasText: playbooks.kinds.core_digest })).toContainText(playbooks.notValidated);
    await editor.getByLabel(playbooks.fields.id).fill(id);
    await editor.getByLabel(playbooks.fields.content).fill("# Négocier son salaire\n\n**R1. Visez le haut de la fourchette.** [S24]");
    await editor.getByLabel(playbooks.fields.model).selectOption({ index: 0 });
    await editor.getByLabel(playbooks.fields.effort).selectOption("high");
    await editor.getByLabel(playbooks.fields.consultWhen).fill("Quand le candidat parle de son salaire.");
    await editor.getByRole("button", { name: playbooks.create.submit }).click();
    await expect(notice(editor)).toHaveText(playbooks.notices.created);
    await expect(editor.getByRole("heading", { level: 1 })).toHaveText("Négocier son salaire");

    // Its author cannot validate it.
    await editor.getByLabel(playbooks.detail.validatorName).fill("Éditrice");
    await editor.getByRole("button", { name: tr(playbooks.detail.validate, { version: "1" }) }).click();
    await expect(alert(editor)).toHaveText(playbooks.notices.own_version);

    // The AI Coach consults it as soon as it is written (not in production, which serves validated versions only).
    expect(await coachPrompt(editor, `Mon salaire ? E2E_CONSULT=${id}`)).toContain(`<avis-playbook id="${id}" version="1">`);

    // Without an Eval Run on it, no one can validate it (ADR-0023, #231).
    await page.goto(`/admin/playbooks/${id}`);
    await expect(page.getByText(evals.validation.noRunOnLatest)).toBeVisible();
    await page.getByLabel(playbooks.detail.validatorName).fill("Paul Validateur");
    await page.getByRole("button", { name: tr(playbooks.detail.validate, { version: "1" }) }).click();
    await expect(alert(page)).toHaveText(tr(playbooks.notices.no_eval_run, { version: "1" }));

    // The editor writes an Eval Case, in French, and evaluates version 1: the AI Coach's whole reply, consulting it, scored by the AI judge.
    await editor.goto(`/admin/playbooks/${id}`);
    await editor.getByLabel(evals.cases.fields.title).fill("Négocie une offre à 85 k€");
    await editor.getByLabel(evals.cases.fields.context).fill("Le candidat s'appelle Paul (prénom seulement). Il a 55 ans et vise un poste de DAF.");
    await editor.getByLabel(evals.cases.fields.message).fill("On m'offre 85 k€, comment négocier ?");
    await editor.getByLabel(evals.cases.fields.inViewKind, { exact: true }).selectOption("job_offer");
    await editor.getByLabel(evals.cases.fields.inViewText).fill("DAF H/F chez Acme Industrie, Lyon, 80 à 90 k€.");
    await editor.getByLabel(evals.cases.fields.criteria).fill("La réponse conseille de viser le haut de la fourchette avec des preuves.");
    await editor.getByRole("button", { name: evals.cases.addButton }).click();
    await expect(notice(editor)).toHaveText(playbooks.notices.caseAdded);
    await expect(editor.getByRole("heading", { name: "Négocie une offre à 85 k€" })).toBeVisible();
    await editor.getByRole("button", { name: evals.runs.startButton }).click();
    await expect(editor).toHaveURL(/\/admin\/evaluations\/[0-9a-f-]{36}$/);
    await expect(editor.getByRole("heading", { level: 1 })).toHaveText(evals.title);
    await expect(editor.getByText(tr(evals.run.subjects.coaching_playbook, { playbook: "Négocier son salaire", version: "1" }))).toBeVisible();
    await expect(editor.getByRole("heading", { name: "Négocie une offre à 85 k€" })).toBeVisible();
    await expect(editor.getByText(id, { exact: true })).toBeVisible();
    await expect(editor.getByText("E2E : la réponse remplit les critères.")).toBeVisible();
    await expect(editor.getByText(tr(evals.runs.scoreValue, { score: "80" })).first()).toBeVisible();

    // Another Administrator reads that run beside the served version's, then validates it, under their name: no score blocks it.
    await page.goto(`/admin/playbooks/${id}`);
    await expect(page.getByText(tr(evals.validation.onLatest, { version: "1" }))).toBeVisible();
    await expect(page.getByText(evals.validation.noRunOnLatest)).toHaveCount(0);
    await page.getByLabel(playbooks.detail.validatorName).fill("Paul Validateur");
    await page.getByRole("button", { name: tr(playbooks.detail.validate, { version: "1" }) }).click();
    await expect(notice(page)).toHaveText(tr(playbooks.notices.validated, { version: "1" }));
    await expect(page.getByRole("navigation", { name: playbooks.detail.versions })).toContainText("Paul Validateur");

    // Changing the validated version makes version 2, to be validated in turn.
    await editor.goto(`/admin/playbooks/${id}`);
    await expect(editor.getByText(tr(playbooks.detail.editValidated, { version: "1", next: "2" }))).toBeVisible();
    await editor.getByLabel(playbooks.fields.content).fill("# Négocier son salaire\n\n**R1. Visez le haut de la fourchette, preuves à l'appui.** [S24]");
    await editor.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(notice(editor)).toHaveText(tr(playbooks.notices.saved, { version: "2" }));
    await editor.goto(`/admin/playbooks/${id}?version=1`);
    await expect(editor.locator(".playbook-rules")).toHaveText("# Négocier son salaire\n\n**R1. Visez le haut de la fourchette.** [S24]");
    expect(await coachPrompt(editor, `Mon salaire ? E2E_CONSULT=${id}`)).toContain(`<avis-playbook id="${id}" version="2">`);

    // Archived: kept, but no longer served.
    await page.goto(`/admin/playbooks/${id}`);
    await page.getByRole("button", { name: playbooks.detail.archive }).click();
    await expect(notice(page)).toHaveText(playbooks.notices.archived);
    expect(await coachPrompt(editor, `Mon salaire ? E2E_CONSULT=${id}`)).not.toContain(`<avis-playbook id="${id}"`);
    await page.goto("/admin/playbooks");
    await expect(page.getByRole("row").filter({ hasText: id })).toContainText(playbooks.archived);

    // The Journal: create, validation, new version, archive, each linking to its version.
    await page.goto("/admin/journal?section=coaching_playbooks&outcome=succeeded");
    const rows = page.getByRole("row").filter({ hasText: id });
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText(admin.journal.actions.archived);
    await expect(rows.nth(1)).toContainText(admin.journal.actions.updated);
    await expect(rows.nth(2)).toContainText(admin.journal.actions.validated);
    await expect(rows.nth(3)).toContainText(admin.journal.actions.added);
    await expect(rows.nth(3)).toContainText(editorEmail);
    // And the two validations refused (#263): by its author, then without an Eval Run; each failed, with its reason.
    await page.goto("/admin/journal?section=coaching_playbooks&outcome=failed");
    const refused = page.getByRole("row").filter({ hasText: id });
    await expect(refused).toHaveCount(2);
    await expect(refused.nth(0)).toContainText(admin.journal.actions.refused);
    await expect(refused.nth(0)).toContainText(admin.journal.outcomes.failed);
    await expect(refused.nth(0)).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.validated, reason: fr.failureReasons.no_eval_run }));
    await expect(refused.nth(1)).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.validated, reason: fr.failureReasons.own_version }));
    await page.goto("/admin/journal?section=coaching_playbooks&outcome=succeeded");
    await rows.nth(2).getByRole("link", { name: tr(admin.journal.viewVersion, { version: "1" }) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/playbooks/${id}\\?version=1$`));

    // The Eval Case's every change is in the Journal too, in its own section.
    await page.goto("/admin/journal?section=eval_cases");
    const caseRows = page.getByRole("row").filter({ hasText: id });
    await expect(caseRows).toHaveCount(1);
    await expect(caseRows.first()).toContainText(admin.journal.actions.added);
    await expect(caseRows.first()).toContainText("Négocie une offre à 85 k€");
  });

  test("a citation missing from the Sources list is refused, naming it; a cited Source cannot leave the list", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);

    await page.goto("/admin/playbooks");
    await page.getByLabel(playbooks.fields.id).fill(`e2e-cite-${unique()}`);
    await page.getByLabel(playbooks.fields.content).fill("# Citer\n\n**R1. Une règle.** [S999]");
    await page.getByLabel(playbooks.fields.model).selectOption({ index: 0 });
    await page.getByLabel(playbooks.fields.consultWhen).fill("Jamais.");
    await page.getByRole("button", { name: playbooks.create.submit }).click();
    await expect(alert(page)).toHaveText(tr(playbooks.notices.unknown_sources, { sources: "S999" }));

    await page.goto("/admin/playbooks/sources");
    const sources = page.getByLabel(playbooks.fields.sourcesContent);
    const withoutS24 = (await sources.inputValue())
      .split("\n")
      .filter((line) => !line.startsWith("| S24 |"))
      .join("\n");
    await sources.fill(withoutS24);
    await page.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(alert(page)).toContainText("S24 (");
    await expect(alert(page)).toContainText("coaching-journey-gamification");
  });

  test("the import left every file as version 1, none Human-validated, each Coaching Playbook with a default Playbook Agent", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const imported = readdirSync("packages/coach-knowledge/playbooks")
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""));
    expect(imported.length).toBeGreaterThanOrEqual(10);

    await page.goto("/admin/playbooks");
    for (const id of imported) {
      const row = page.getByRole("row").filter({ has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(playbooks.notValidated);
      // Effort medium, on the AI Coach's route; never already served as validated.
      await expect(row).toContainText(`${fr.admin.coachingPlaybooks.efforts.medium}`);
      await expect(row).toContainText(tr(playbooks.version, { version: "1" }));
    }
    // The e2e environment serves the latest versions, which the page says.
    await expect(page.getByText(playbooks.servingLatest)).toBeVisible();
    for (const kind of ["core_digest", "sources"]) {
      await expect(page.getByRole("row").filter({ hasText: playbooks.kinds[kind] })).toContainText(playbooks.notValidated);
    }

    await page.goto(`/admin/playbooks/${imported[0]}?version=1`);
    await expect(page.getByText(playbooks.detail.importAuthor)).toBeVisible();
    await expect(page.getByText(playbooks.notValidated, { exact: true })).toBeVisible();
    await expect(page.locator(".playbook-rules")).not.toBeEmpty();
    await expect(page.getByLabel(playbooks.fields.consultWhen)).not.toHaveValue("");
  });

  test("the AI tasks' playbooks are listed apart, imported validated by François Nader but for the Job Offer Summary's, and never ask when to consult them", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/playbooks");

    const tasks = page.getByRole("table", { name: playbooks.tasks.caption });
    await expect(page.getByRole("heading", { level: 2, name: playbooks.tasks.title })).toBeVisible();
    const row = (id: string) => tasks.getByRole("row").filter({ has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
    for (const id of ["cv-reading", "tailored-cv", "cover-letter", "outreach-message", "follow-up", "coach-memory", "company-news-search", "job-search-queries", "back-office-assistant"]) {
      await expect(row(id)).toContainText("François Nader");
    }
    await expect(row("job-offer-reading")).toContainText(playbooks.notValidated);
    // #405: its version 2, whose Playbook Agent reads the pages found, imported not validated after its validated version 1.
    await expect(row("company-facts-search")).toContainText(`${tr(playbooks.version, { version: "2" })}, ${playbooks.notValidated}`);
    await expect(tasks.getByRole("row").filter({ hasText: "company-news-search" })).toContainText(playbooks.tasks.webSearch);
    // The AI Coach's own table holds none of them.
    await expect(page.getByRole("table", { name: playbooks.caption }).getByRole("row").filter({ hasText: "cv-reading" })).toHaveCount(0);

    await tasks.getByRole("link", { name: "Lire une offre d'emploi : résumé et secteur" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lire une offre d'emploi : résumé et secteur");
    await expect(page.getByLabel(playbooks.fields.taskContent)).not.toHaveValue("");
    await expect(page.getByLabel(playbooks.fields.taskModel)).toBeVisible();
    await expect(page.getByLabel(playbooks.fields.consultWhen)).toHaveCount(0);
  });

  test("editing the job-offer-reading task Playbook changes the rules a Job Offer is read with", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const rule = `- "summary" : règle E2E ${unique()}.`;

    // e2e serves the latest version: saved, it is used at once (production would wait for its validation).
    await page.goto("/admin/playbooks/job-offer-reading");
    const content = page.getByLabel(playbooks.fields.taskContent);
    await content.fill(`${(await content.inputValue()).trim()}\n${rule}`);
    await page.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(notice(page)).toHaveText(tr(playbooks.notices.saved, { version: "1" }));

    // A Job Offer read now: the fake AI echoes the last rule it was sent as the summary.
    const profile = await page.request.post("/api/profiles", {
      headers: { origin },
      data: {
        masterCv: { fullName: "Paul Validateur", headline: "DAF", email: "paul.validateur@example.fr", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] },
        searchCriteria: { targetRole: "DAF", locations: ["Lyon"] },
      },
    });
    expect(profile.status(), await profile.text()).toBe(201);
    const offer = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: { source: { url: `https://www.apec.fr/offres/regles-${unique()}` }, title: "DAF H/F", content: `Groupe Ferlac recrute son DAF. E2E_ECHO_RULES ${unique()}`, employer: "Groupe Ferlac" },
    });
    expect(offer.status(), await offer.text()).toBe(200);
    const application = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id } });
    expect(application.ok(), await application.text()).toBe(true);

    const summary = await page.request.post(`/api/applications/${(await application.json()).id}/job-offer-summary`, { headers: { origin } });
    expect(summary.status(), await summary.text()).toBe(200);
    expect((await summary.json()).summary).toBe(rule);
  });

  test("a task Playbook's text must keep the sections and slots its task reads", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/playbooks/company-facts-search");
    await page.getByLabel(playbooks.fields.taskContent).fill("Fiche de l'entreprise : pays et effectif.");
    await page.getByRole("button", { name: playbooks.detail.save }).click();
    await expect(alert(page)).toHaveText(tr(playbooks.notices.task_instructions, { list: "## requête, ## lecture" }));
  });

  test("the Back Office offers only allowed models, and says when a model ignores the effort", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/playbooks");
    const groups = await page.getByLabel(playbooks.fields.model).locator("optgroup").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("label") ?? ""));
    expect(groups.length).toBeGreaterThan(0);
    // No endpoint outside the European Union is offered.
    for (const group of groups) expect(group, group).not.toMatch(/api\.openai\.com|api\.anthropic\.com|api\.mistral\.ai\/us|\.us-[a-z]+-\d/);
    await expect(page.getByText(playbooks.fields.effortHelp)).toBeVisible();
  });

  test("Support reads the Coaching Playbooks without any way to change them", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const supportEmail = newAddress("playbook-support");
    const support = await personPage(browser, supportEmail);
    await grant(page, supportEmail, "support");

    await support.goto("/admin/playbooks/core-digest");
    await expect(support.getByRole("heading", { level: 1 })).toHaveText(playbooks.kinds.core_digest);
    await expect(support.getByText(admin.readOnly)).toBeVisible();
    await expect(support.getByRole("button", { name: playbooks.detail.save })).toBeDisabled();
    await expect(support.getByRole("button", { name: tr(playbooks.detail.validate, { version: "1" }) })).toBeDisabled();
  });
});
