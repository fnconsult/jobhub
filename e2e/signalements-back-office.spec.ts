import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #376: « Signalements » in the Back Office, first under « Candidats ». Support and super-admins read every one,
// with the Candidate's email and Plan, change its status in any direction and reply once, until « traité »; a Question
// is marked « traité » only once replied to. Help editors read the Questions alone, without who sent them; other roles
// get « Accès refusé », recorded. The Back Office Audit keeps ids and statuses, never the words. Candidates send their
// Signalements through POST /api/signalements (#374).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.signalements;
const page404 = fr.notFound.title;
const SUPER_ADMIN = "signalements-office@e2e.jobbbox.test";
const PATH = "/admin/signalements";
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
/** A word of letters alone, its own to each run. */
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

const navOf = (page: Page) => page.getByRole("navigation", { name: admin.nav.label });
const rowOf = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });
const mainOf = (page: Page) => page.getByRole("main");
const ONE = /\/admin\/signalements\/[0-9a-f-]{36}$/;
/** Opens the Signalement `row` links to and returns its id, once its page is shown. */
async function openFrom(page: Page, row: ReturnType<Page["getByRole"]>): Promise<string> {
  await row.getByRole("link").click();
  await expect(page).toHaveURL(ONE);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants `role` to the account with `email`. */
async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles[role] }));
}

/** A Candidate (`email`) sends a Bug, an Idée and a Question, in this order, each naming `ref`. */
async function sendThree(browser: Browser, email: string, ref: string) {
  const candidate = await personPage(browser, email);
  const send = async (data: Record<string, unknown>) => {
    const sent = await candidate.request.post("/api/signalements", { data, headers: { origin } });
    expect(sent.status(), await sent.text()).toBe(201);
  };
  await send({ type: "bug", message: `Le bouton Enregistrer ne répond pas ${ref}`, path: "/candidatures?onglet=lettre", textSize: "large" });
  await send({ type: "idee", message: `Trier les candidatures par relance ${ref}`, path: "/candidatures", textSize: "standard" });
  await send({
    type: "question",
    message: `L'aide ne m'a pas dit comment changer d'offre ${ref}`,
    path: "/compte",
    textSize: "standard",
    attachedQuestion: `Comment passer à l'offre Standard ? ${ref}`,
    attachedCoachReply: `Je ne trouve pas d'article sur ce point ${ref}`,
  });
  await candidate.context().close();
}

/** The « à traiter » count next to Signalements in the sidebar, or null when none is shown. */
async function sidebarCount(page: Page): Promise<number | null> {
  const count = navOf(page).getByRole("link", { name: new RegExp(`^${texts.title}`) }).locator(".sidebar-count [aria-hidden=true]");
  return (await count.count()) === 0 ? null : Number(await count.innerText());
}

test.describe("« Signalements » in the Back Office (#376)", () => {
  test("Support reads them oldest first with the Candidate's email and Plan, marks a Bug « traité », and answers a Question before marking it « traité »", async ({ page, browser }) => {
    const ref = tag();
    const candidateEmail = newAddress("signalements-candidate");
    await sendThree(browser, candidateEmail, ref);
    await signInWithMagicLink(page, SUPER_ADMIN);
    const supportEmail = newAddress("signalements-support");
    const support = await personPage(browser, supportEmail);
    await grant(page, supportEmail, "support");

    // « Candidats » is the sidebar's first group; Signalements carries its « à traiter » count, equal to the rows the list shows by default.
    await support.goto("/admin");
    await expect(navOf(support).getByRole("heading").first()).toHaveText(admin.nav.groups.candidates);
    await navOf(support).getByRole("link", { name: new RegExp(`^${texts.title}`) }).click();
    await expect(support).toHaveTitle(`${texts.title} · ${admin.title}`);
    await expect(support.getByRole("navigation", { name: texts.statusFilter }).getByRole("link", { name: texts.toHandle })).toHaveAttribute("aria-current", "page");
    // Other tests send Signalements meanwhile: the sidebar kept from /admin (or read a moment apart from the list) may be
    // one behind, so both are read again from one fresh load until they agree.
    await expect
      .poll(async () => {
        await support.reload();
        return (await sidebarCount(support)) === (await mainOf(support).getByRole("table").locator("tbody tr").count());
      })
      .toBe(true);
    await expect(mainOf(support)).not.toContainText(admin.readOnly);
    // Nothing on the home.
    await support.goto("/admin");
    await expect(mainOf(support)).not.toContainText(texts.title);
    await support.goto(PATH);

    // Oldest first, each with its type, date, start of the message, page, version, browser, language, Text Size, email and Plan.
    const ours = rowOf(support, ref);
    await expect(ours).toHaveCount(3);
    await expect(ours.getByRole("rowheader")).toHaveText([
      `Le bouton Enregistrer ne répond pas ${ref}`,
      `Trier les candidatures par relance ${ref}`,
      `L'aide ne m'a pas dit comment changer d'offre ${ref}`,
    ]);
    const bug = ours.nth(0);
    await expect(bug.getByRole("cell").nth(0)).toHaveText(texts.types.bug);
    await expect(bug).toContainText("/candidatures");
    await expect(bug).not.toContainText("onglet");
    await expect(bug).toContainText(fr.textSize.large);
    await expect(bug).toContainText(fr.languages.fr);
    await expect(bug).toContainText(candidateEmail);
    await expect(bug).toContainText(fr.billing.plans.free);
    await expect(bug).toContainText(texts.statuses.nouveau);
    const results = await new AxeBuilder({ page: support }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);

    // Filters: the Idées alone.
    await support.getByRole("navigation", { name: texts.typeFilter }).getByRole("link", { name: texts.types.idee }).click();
    await expect(rowOf(support, ref)).toHaveCount(1);
    await expect(rowOf(support, ref).getByRole("rowheader")).toHaveText(`Trier les candidatures par relance ${ref}`);

    // A Bug: marked « traité » without a reply; it leaves « à traiter ».
    await support.goto(PATH);
    const bugId = await openFrom(support, rowOf(support, ref).nth(0));
    await support.getByRole("button", { name: tr(texts.markAs, { status: texts.statuses.traite }) }).click();
    await expect(mainOf(support).getByRole("status")).toHaveText(texts.notices.status);
    await expect(mainOf(support)).toContainText(tr(texts.statusNow, { status: texts.statuses.traite }));
    await support.goto(PATH);
    await expect(rowOf(support, ref)).toHaveCount(2);

    // A Question: opening it shows it in full, changes nothing.
    const questionId = await openFrom(support, rowOf(support, ref).nth(1));
    await expect(mainOf(support)).toContainText(`Comment passer à l'offre Standard ? ${ref}`);
    await expect(mainOf(support)).toContainText(`Je ne trouve pas d'article sur ce point ${ref}`);
    await expect(mainOf(support)).toContainText(tr(texts.statusNow, { status: texts.statuses.nouveau }));
    const detail = await new AxeBuilder({ page: support }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(detail.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);

    // « Traité » before a reply is refused.
    await support.getByRole("button", { name: tr(texts.markAs, { status: texts.statuses.traite }) }).click();
    await expect(mainOf(support).getByRole("alert")).toHaveText(texts.notices.reply_required);
    await expect(mainOf(support)).toContainText(tr(texts.statusNow, { status: texts.statuses.nouveau }));

    // The reply, signed « L'équipe Jobbbox », then « traité »: the reply can no longer be changed.
    await expect(mainOf(support)).toContainText(texts.signature);
    await support.getByRole("textbox", { name: texts.replyTitle }).fill(`Rendez-vous dans Mon compte, rubrique Offre ${ref}`);
    await support.getByRole("button", { name: texts.saveReply }).click();
    await expect(mainOf(support).getByRole("status")).toHaveText(texts.notices.reply);
    await support.getByRole("button", { name: tr(texts.markAs, { status: texts.statuses.traite }) }).click();
    await expect(mainOf(support).getByRole("status")).toHaveText(texts.notices.status);
    await expect(mainOf(support)).toContainText(texts.replyLocked);
    await expect(support.getByRole("textbox", { name: texts.replyTitle })).toHaveCount(0);
    await expect(mainOf(support)).not.toContainText(supportEmail.split("@")[0]!);

    // In the Journal: the Signalements' ids and statuses, whether a reply was written, never a word of them; and the refused attempt.
    await page.goto(`/admin/journal?section=signalements`);
    await expect(mainOf(page)).not.toContainText(ref);
    const bugEntry = page.getByRole("row").filter({ hasText: bugId });
    await expect(bugEntry).toHaveCount(1);
    await expect(bugEntry).toContainText(supportEmail);
    await expect(bugEntry).toContainText(texts.statuses.nouveau);
    await expect(bugEntry).toContainText(texts.statuses.traite);
    const questionEntries = page.getByRole("row").filter({ hasText: questionId });
    await expect(questionEntries).toHaveCount(3);
    await expect(questionEntries.filter({ hasText: fr.failureReasons.reply_required })).toHaveCount(1);
    await expect(questionEntries.filter({ hasText: texts.replyStates.written })).toHaveCount(1);

    await support.context().close();
  });

  test("a Help editor reads the Questions alone, without email or Plan, and changes nothing; a Plans manager gets « Accès refusé », recorded", async ({ page, browser }) => {
    const ref = tag();
    const candidateEmail = newAddress("signalements-help-candidate");
    await sendThree(browser, candidateEmail, ref);
    await signInWithMagicLink(page, SUPER_ADMIN);
    const helpEditorEmail = newAddress("signalements-help-editor");
    const plansManagerEmail = newAddress("signalements-plans-manager");
    const helpEditor = await personPage(browser, helpEditorEmail);
    const plansManager = await personPage(browser, plansManagerEmail);
    await grant(page, helpEditorEmail, "help-editor");
    await grant(page, plansManagerEmail, "plans-manager");

    // The super-admin's view holds the Bug's id, to try it as the Help editor.
    await page.goto(`${PATH}?type=bug`);
    const bugPath = `${PATH}/${await openFrom(page, rowOf(page, ref))}`;

    await helpEditor.goto(PATH);
    await expect(mainOf(helpEditor)).toContainText(texts.questionsOnly);
    expect(await sidebarCount(helpEditor)).toBeNull();
    await expect(rowOf(helpEditor, ref)).toHaveCount(1);
    await expect(rowOf(helpEditor, ref).getByRole("cell").nth(0)).toHaveText(texts.types.question);
    await expect(mainOf(helpEditor)).not.toContainText(candidateEmail);
    await expect(mainOf(helpEditor).getByRole("columnheader", { name: texts.plan })).toHaveCount(0);
    await expect(helpEditor.getByRole("navigation", { name: texts.typeFilter })).toHaveCount(0);
    await openFrom(helpEditor, rowOf(helpEditor, ref));
    await expect(mainOf(helpEditor)).toContainText(`Comment passer à l'offre Standard ? ${ref}`);
    await expect(mainOf(helpEditor)).not.toContainText(candidateEmail);
    await expect(helpEditor.getByRole("button", { name: tr(texts.markAs, { status: texts.statuses.vu }) })).toBeDisabled();
    expect((await helpEditor.goto(bugPath))?.status()).toBe(404);

    // A Plans manager: not in the sidebar, 404, and « Accès refusé » in the Journal under Signalements.
    await plansManager.goto("/admin");
    await expect(navOf(plansManager).getByRole("link", { name: new RegExp(`^${texts.title}`) })).toHaveCount(0);
    const response = await plansManager.goto(PATH);
    expect(response?.status()).toBe(404);
    await expect(plansManager.getByRole("heading", { level: 1 })).toHaveText(page404);
    await page.goto(`/admin/journal?section=signalements`);
    const denied = page.getByRole("row").filter({ hasText: plansManagerEmail });
    await expect(denied).toHaveCount(1);
    await expect(denied).toContainText(admin.journal.actions.denied);
    await expect(denied).toContainText(fr.failureReasons.role_missing);

    for (const each of [helpEditor, plansManager]) await each.context().close();
  });
});
