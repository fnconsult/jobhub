import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #377: « Mes signalements », a Section of Mon compte before « Mes données », where the Candidate follows the
// Signalements they sent (#374), newest first, with the team's reply (#376), and deletes one; and the Signalement
// notification, atop every workspace page, when the team replied or marked one « traité ». Driven in the browser; the
// Signalements are sent through POST /api/signalements, replies saved in the database or in the Back Office.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const mine = fr.mySignalements;
const notices = fr.signalementNotifications;
const dialogTexts = fr.signalement;
const office = fr.admin.signalements;
const SUPER_ADMIN = "mes-signalements-office@e2e.jobbbox.test";
const SECTION = "/compte/signalements";
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
/** A word of letters alone, its own to each run. */
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
/** The day a Signalement sent on 25 October is named by: this year's, or with the year. */
const OCTOBER_25 = /25 octobre( \d{4})?/;
const textOf = (template: string) => new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{\\{date\\}\\}", OCTOBER_25.source)}$`);

const sectionOf = (page: Page) => page.getByRole("main");
const itemOf = (page: Page, text: string) => sectionOf(page).getByRole("listitem").filter({ hasText: text });
const notificationsOf = (page: Page) => page.getByRole("list", { name: notices.label });
const notificationOf = (page: Page, text: RegExp) => notificationsOf(page).getByRole("listitem").filter({ hasText: text });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: dialogTexts.title });

async function withDb<T>(run: (db: pg.Pool) => Promise<T>): Promise<T> {
  const db = new pg.Pool({ connectionString: databaseUrl });
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Sends a Signalement for the signed-in Candidate of `page`; returns its id. */
async function send(page: Page, data: Record<string, unknown>): Promise<string> {
  const sent = await page.request.post("/api/signalements", { data: { path: "/candidatures", textSize: "standard", ...data }, headers: { origin } });
  expect(sent.status(), await sent.text()).toBe(201);
  return (await sent.json()).signalement.id;
}

/** Saves the team's reply straight in the database, as sent on 25 October 2025 and replied to on the 26th, changed on the 27th when `changed`. */
async function replyInDatabase(id: string, reply: string, { changed = false } = {}) {
  await withDb((db) =>
    db.query(
      `UPDATE signalement SET created_at = '2025-10-25T09:30:00Z', reply = $2, replied_at = '2025-10-26T10:00:00Z',
         reply_updated_at = CASE WHEN $3 THEN '2025-10-27T10:00:00Z'::timestamptz ELSE '2025-10-26T10:00:00Z'::timestamptz END WHERE id = $1`,
      [id, reply, changed],
    ),
  );
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("« Mes signalements » and the Signalement notification (#377)", () => {
  test("a reply saved in the database shows in the Section; its notification appears on another page and goes away when closed or when the Section is opened", async ({ page }) => {
    const ref = tag();
    await signInWithMagicLink(page, newAddress("mes-signalements-reply"));
    const closed = await send(page, { type: "bug", message: `Le bouton Enregistrer ne répond pas ${ref}` });
    const seenThere = await send(page, { type: "idee", message: `Trier les candidatures par relance ${ref}` });
    const question = await send(page, {
      type: "question",
      message: `L'aide ne m'a pas dit comment changer d'offre ${ref}`,
      attachedQuestion: `Comment passer à l'offre Standard ? ${ref}`,
      attachedCoachReply: `Je ne trouve pas d'article sur ce point ${ref}`,
    });
    await replyInDatabase(closed, `Merci, c'est corrigé ${ref}`);
    await replyInDatabase(seenThere, `Bonne idée, c'est prévu ${ref}`, { changed: true });
    await replyInDatabase(question, `Rendez-vous dans Mon compte, rubrique Abonnement ${ref}`);

    // On another page: one notification for each, « Voir » leading to the Section.
    await page.goto("/candidatures");
    await expect(notificationsOf(page).getByRole("listitem")).toHaveCount(3);
    const replied = textOf(notices.replied);
    await expect(notificationsOf(page).getByRole("listitem").first().locator("p")).toHaveText(replied);
    await expectNoAxeViolations(page, ".signalement-notifications");

    // Closed: gone, and still gone on the next page.
    const closing = page.waitForResponse((response) => response.url().endsWith("/notification") && response.request().method() === "DELETE");
    await notificationsOf(page).getByRole("listitem").first().getByRole("button", { name: notices.dismiss }).click();
    expect((await closing).status()).toBe(204);
    await expect(notificationsOf(page).getByRole("listitem")).toHaveCount(2);
    await page.goto("/compte/profils");
    await expect(notificationsOf(page).getByRole("listitem")).toHaveCount(2);

    // « Voir » opens the Section, where no notification is shown, and opening it closes them all.
    await notificationsOf(page).getByRole("listitem").first().getByRole("link", { name: notices.see }).click();
    await expect(page).toHaveURL(new RegExp(`${SECTION}$`));
    await expect(notificationsOf(page)).toHaveCount(0);
    await expect(sectionOf(page).getByRole("heading", { name: mine.title, level: 2 })).toBeVisible();

    // Newest first, each with its message, status and the team's reply, dated, « modifiée le … » once changed.
    await expect(sectionOf(page).getByRole("list", { name: mine.listLabel }).getByRole("listitem").filter({ hasText: ref })).toHaveCount(3);
    const bug = itemOf(page, `Le bouton Enregistrer ne répond pas ${ref}`);
    await expect(bug.getByRole("heading", { level: 3 })).toHaveText(new RegExp(`^${fr.mySignalements.types.bug} du ${OCTOBER_25.source}$`));
    await expect(bug).toContainText(tr(mine.status, { status: mine.statuses.nouveau }));
    const bugReply = bug.getByRole("region", { name: mine.reply });
    await expect(bugReply).toContainText(`Merci, c'est corrigé ${ref}`);
    await expect(bugReply).toContainText(/26 octobre/);
    await expect(bugReply).not.toContainText(tr(mine.changedOn, { date: "" }).trim());
    const idea = itemOf(page, `Trier les candidatures par relance ${ref}`);
    await expect(idea.getByRole("region", { name: mine.reply })).toContainText(new RegExp(`${tr(mine.changedOn, { date: "" }).trim()} 27 octobre`));

    // A Question: what was attached, collapsed.
    const asked = itemOf(page, `L'aide ne m'a pas dit comment changer d'offre ${ref}`);
    await expect(asked.getByText(`Je ne trouve pas d'article sur ce point ${ref}`)).toBeHidden();
    await asked.getByText(mine.attached).click();
    await expect(asked.getByText(`Je ne trouve pas d'article sur ce point ${ref}`)).toBeVisible();
    await expect(asked.getByText(`Comment passer à l'offre Standard ? ${ref}`)).toBeVisible();
    await expectNoAxeViolations(page, "main");

    // Back on another page, nothing more: the Section was opened.
    await page.goto("/candidatures");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(notificationsOf(page)).toHaveCount(0);
  });

  test("marking « vu » shows no notification; marking « traité » with no reply shows one", async ({ page, browser }) => {
    const ref = tag();
    const candidate = await personPage(browser, newAddress("mes-signalements-status"));
    const id = await send(candidate, { type: "bug", message: `La page Agenda reste blanche ${ref}` });
    await signInWithMagicLink(page, SUPER_ADMIN);

    await page.goto(`/admin/signalements/${id}`);
    const markVu = page.getByRole("button", { name: tr(office.markAs, { status: office.statuses.vu }) });
    await markVu.click();
    // The saved status, rendered after the redirect, is the sync point: the notice reads the same after each change.
    await expect(markVu).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("main").getByRole("status")).toHaveText(office.notices.status);
    await candidate.goto("/candidatures");
    await expect(candidate.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(notificationsOf(candidate)).toHaveCount(0);

    const markTraite = page.getByRole("button", { name: tr(office.markAs, { status: office.statuses.traite }) });
    await markTraite.click();
    // The « vu » notice is still on screen, so only the pressed « traité » button shows the change was saved.
    await expect(markTraite).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("main").getByRole("status")).toHaveText(office.notices.status);
    await candidate.goto("/agenda");
    const handled = notificationOf(candidate, /./);
    await expect(handled).toHaveCount(1);
    await expect(handled.locator("p")).toHaveText(new RegExp(`^${notices.handled.replace("{{date}}", "\\d{1,2} \\p{L}+( \\d{4})?").replace(/[.]/g, "\\.")}$`, "u"));

    // In the Section: « Traité », with no reply.
    await handled.getByRole("link", { name: notices.see }).click();
    const item = itemOf(candidate, `La page Agenda reste blanche ${ref}`);
    await expect(item).toContainText(tr(mine.status, { status: mine.statuses.traite }));
    await expect(item.getByRole("region", { name: mine.reply })).toHaveCount(0);
    await candidate.context().close();
  });

  test("deleting a Signalement, once confirmed, removes it from the Section and from the Back Office", async ({ page, browser }) => {
    const ref = tag();
    const candidate = await personPage(browser, newAddress("mes-signalements-delete"));
    await send(candidate, { type: "bug", message: `Un bug à garder ${ref}` });
    await send(candidate, { type: "idee", message: `Une idée à supprimer ${ref}` });
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`/admin/signalements?statut=tous`);
    await expect(page.getByRole("row").filter({ hasText: `Une idée à supprimer ${ref}` })).toHaveCount(1);

    await candidate.goto(SECTION);
    const doomed = itemOf(candidate, `Une idée à supprimer ${ref}`);
    // No editing: the message is plain text.
    await expect(doomed.getByRole("textbox")).toHaveCount(0);
    // Asked first; « Non, garder » keeps it.
    await doomed.getByRole("button", { name: new RegExp(`^${mine.delete}`) }).click();
    await expect(doomed.getByText(mine.confirmDelete)).toBeVisible();
    await expect(doomed.getByRole("button", { name: mine.confirm })).toBeFocused();
    await doomed.getByRole("button", { name: mine.keep }).click();
    await expect(doomed.getByRole("button", { name: new RegExp(`^${mine.delete}`) })).toBeFocused();

    await doomed.getByRole("button", { name: new RegExp(`^${mine.delete}`) }).click();
    await doomed.getByRole("button", { name: mine.confirm }).click();
    await expect(itemOf(candidate, `Une idée à supprimer ${ref}`)).toHaveCount(0);
    await expect(itemOf(candidate, `Un bug à garder ${ref}`)).toHaveCount(1);
    await candidate.reload();
    await expect(itemOf(candidate, `Un bug à garder ${ref}`)).toHaveCount(1);
    await expect(itemOf(candidate, `Une idée à supprimer ${ref}`)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: `Un bug à garder ${ref}` })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: `Une idée à supprimer ${ref}` })).toHaveCount(0);
    await candidate.context().close();
  });

  test("the empty state's two buttons open the Signalement dialog with that type; once sent, « Voir mes signalements » shows it in the Section", async ({ page }) => {
    const ref = tag();
    await signInWithMagicLink(page, newAddress("mes-signalements-empty"));
    await page.goto("/compte");
    // Before « Mes données » among Mon compte's Sections.
    const sections = page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).getByRole("link");
    const names = await sections.allInnerTexts();
    expect(names.indexOf(fr.account.sections.signalements)).toBe(names.indexOf(fr.account.sections.data) - 1);
    await sections.filter({ hasText: fr.account.sections.signalements }).click();
    await expect(page).toHaveURL(new RegExp(`${SECTION}$`));

    await expect(sectionOf(page)).toContainText(mine.empty);
    await expectNoAxeViolations(page, "main");

    await sectionOf(page).getByRole("button", { name: mine.reportProblem }).click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(dialogOf(page).getByRole("radio", { name: dialogTexts.types.bug })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(sectionOf(page).getByRole("button", { name: mine.reportProblem })).toBeFocused();

    await sectionOf(page).getByRole("button", { name: mine.proposeIdea }).click();
    await expect(dialogOf(page).getByRole("radio", { name: dialogTexts.types.idee })).toBeChecked();
    await expectNoAxeViolations(page, "[role=dialog]");
    await dialogOf(page).getByRole("textbox").fill(`Pouvoir trier par date de relance ${ref}`);
    await dialogOf(page).getByRole("button", { name: dialogTexts.send, exact: true }).click();
    await expect(dialogOf(page).getByRole("status")).toContainText(dialogTexts.thanks);
    await expect(dialogOf(page).getByRole("button", { name: dialogTexts.close })).toBeVisible();

    await dialogOf(page).getByRole("link", { name: dialogTexts.seeMine }).click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(sectionOf(page).getByRole("heading", { name: mine.title, level: 2 })).toBeFocused();
    const sent = itemOf(page, `Pouvoir trier par date de relance ${ref}`);
    await expect(sent.getByRole("heading", { level: 3 })).toContainText(mine.types.idee);
    await expect(sent).toContainText(tr(mine.status, { status: mine.statuses.nouveau }));
  });

  test("the dialog opened from the Sidebar offers « Voir mes signalements » after sending, leading to the Section", async ({ page }) => {
    const ref = tag();
    await signInWithMagicLink(page, newAddress("mes-signalements-sidebar"));
    await page.goto("/candidatures");
    await page.locator(".sidebar-docked").getByRole("button", { name: dialogTexts.open, exact: true }).click();
    await dialogOf(page).getByRole("textbox").fill(`Le tri des candidatures se perd ${ref}`);
    await dialogOf(page).getByRole("button", { name: dialogTexts.send, exact: true }).click();
    const actions = dialogOf(page).locator(".signalement-actions");
    await expect(actions.getByRole("link", { name: dialogTexts.seeMine })).toBeVisible();
    await expect(actions.getByRole("button", { name: dialogTexts.close })).toBeVisible();

    await actions.getByRole("link", { name: dialogTexts.seeMine }).click();
    await expect(page).toHaveURL(new RegExp(`${SECTION}$`));
    await expect(itemOf(page, `Le tri des candidatures se perd ${ref}`)).toHaveCount(1);
  });
});
