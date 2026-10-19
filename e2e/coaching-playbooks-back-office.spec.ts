import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #225: the Back Office's Coaching Playbooks section. A Playbook editor (granted by a super-admin
// on the Administrateurs page) creates and versions playbooks; another Administrator validates a
// version, naming themselves; changing a validated version makes a new one; a playbook is archived,
// never deleted; every step is in the Journal with a link to its version. The e2e server serves the
// latest versions (JOBHUB_TARGET=e2e), so the AI Coach consults what was just written: its fake
// (fake-mistral.mjs) consults the Playbook Agents a message lists after "E2E_CONSULT=", and returns its
// system prompt for "E2E_SHOW_CONTEXT".
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const playbooks = admin.coachingPlaybooks;
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
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `${message} E2E_SHOW_CONTEXT` } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).reply;
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
    await expect(editor.getByRole("navigation", { name: admin.nav.label }).getByRole("link")).toHaveText([admin.sections.coachingPlaybooks, admin.nav.account]);
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

    // Another Administrator validates it, under their name.
    await page.goto(`/admin/playbooks/${id}`);
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
    await page.goto("/admin/journal?section=coaching_playbooks");
    const rows = page.getByRole("row").filter({ hasText: id });
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText(admin.journal.actions.archived);
    await expect(rows.nth(1)).toContainText(admin.journal.actions.updated);
    await expect(rows.nth(2)).toContainText(admin.journal.actions.validated);
    await expect(rows.nth(3)).toContainText(admin.journal.actions.added);
    await expect(rows.nth(3)).toContainText(editorEmail);
    await rows.nth(2).getByRole("link", { name: tr(admin.journal.viewVersion, { version: "1" }) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/playbooks/${id}\\?version=1$`));
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
