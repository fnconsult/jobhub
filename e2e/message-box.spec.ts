import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { conversationOf, toConversation } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #933: the conversation's message box starts on one line and grows with the text, up to about 8 lines, then
// scrolls inside; sent, it is one line again. On a computer the « Coach IA » badge and « Envoyer au coach » stand on its
// row, so the box is one line; on a phone they keep the row under it. In words while the box is empty, they shrink to
// « IA » and the Enter key once the Candidate writes; the keyboard's focus, or the pointer resting 2
// seconds on one, shows its words, floating over the text. Enter sends, Shift+Enter starts a line, as before.
// The AI Coach is faked by e2e/support/fake-mistral.mjs.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const COMPUTER = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const boxOf = (page: Page) => conversationOf(page).getByRole("textbox", { name: fr.coachPanel.messageLabel });
const sendOf = (page: Page) => conversationOf(page).getByRole("button", { name: fr.coachPanel.send });
const badgeOf = (page: Page) => conversationOf(page).getByRole("button", { name: fr.conversationFirst.welcomeOpen });
const heightOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.height);
const lineHeightOf = (box: Locator) => box.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));

/** Writes `lines` lines in the box, Shift+Enter between them. */
async function writeLines(page: Page, lines: number) {
  await boxOf(page).click();
  for (let line = 1; line <= lines; line++) {
    await page.keyboard.type(`Ligne ${line}`);
    if (line < lines) await page.keyboard.press("Shift+Enter");
  }
}

async function openConversation(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await signInWithMagicLink(page, newAddress("message-box"));
  await toConversation(page);
  await expect(boxOf(page)).toBeVisible();
}

for (const [name, size] of [
  ["computer", COMPUTER],
  ["phone", PHONE],
] as const) {
  test.describe(`the message box on a ${name} (#933)`, () => {
    test("starts on one line, grows with the text up to 8 lines, then scrolls; sent, it is one line again", async ({ page }) => {
      await openConversation(page, size);
      const box = boxOf(page);
      const line = await lineHeightOf(box);
      const oneLine = await heightOf(box);
      // One line: as tall as « Envoyer au coach », never two lines.
      expect(oneLine).toBe(await heightOf(sendOf(page)));
      expect(oneLine).toBeLessThan(2 * line);

      await writeLines(page, 3);
      await expect.poll(() => heightOf(box)).toBe(Math.round(oneLine + 2 * line));
      expect(await box.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);

      await page.keyboard.press("Shift+Enter");
      await writeLines(page, 12);
      await expect.poll(() => heightOf(box)).toBe(Math.round(oneLine + 7 * line));
      expect(await box.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

      // Enter sends; the box is one line again, and keeps the focus.
      await page.keyboard.press("Enter");
      await expect(box).toHaveValue("");
      await expect.poll(() => heightOf(box)).toBe(oneLine);
      await expect(box).toBeFocused();

      const axe = await new AxeBuilder({ page }).include(".page-conversation-foot").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map(({ id }) => id)).toEqual([]);
    });
  });
}

test("on a computer the badge and Send stand on the box's row in words; writing, they shrink to their icons, the text wrapping beside them (#933)", async ({ page }) => {
  await openConversation(page, COMPUTER);
  const empty = (await boxOf(page).boundingBox())!;
  const sendEmpty = (await sendOf(page).boundingBox())!;
  const badgeEmpty = (await badgeOf(page).boundingBox())!;
  // In words, at the box's right, on its row.
  await expect(sendOf(page)).toHaveText(fr.coachPanel.send);
  expect(badgeEmpty.x).toBeGreaterThan(empty.x + empty.width - 1);
  expect(sendEmpty.x).toBeGreaterThan(badgeEmpty.x);
  expect(Math.round(sendEmpty.y)).toBe(Math.round(empty.y));

  await boxOf(page).click();
  await page.keyboard.type("Je prépare un entretien pour un poste de Head of Business Unit Professional Services chez Canal+ la semaine prochaine.");
  // Icons: as tall as wide, the box wider for the text, which wraps beside them.
  const control = Math.round(sendEmpty.height);
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.width)).toBe(control);
  expect(Math.round((await badgeOf(page).boundingBox())!.width)).toBe(control);
  // The badge says « IA », in words: the AI disclosure stays (AI Act art. 50(1)).
  await expect(badgeOf(page).locator(".composer-short")).toBeVisible();
  await expect(badgeOf(page).locator(".composer-short")).toHaveText(fr.coachPanel.badgeShort);
  await expect(sendOf(page).locator(".composer-label")).not.toBeInViewport();
  const writing = (await boxOf(page).boundingBox())!;
  expect(writing.width).toBeGreaterThan(empty.width + 100);
  expect(writing.height).toBeGreaterThan(empty.height);
  const send = (await sendOf(page).boundingBox())!;
  expect(send.x).toBeGreaterThan(writing.x + writing.width - 1);
  expect(Math.round(send.y + send.height)).toBe(Math.round(writing.y + writing.height));

  // The pointer resting on Send for 2 seconds: its words, floating over the text, the text unmoved.
  await page.mouse.move(send.x + send.width / 2, send.y + send.height / 2);
  await page.waitForTimeout(1000);
  expect(Math.round((await sendOf(page).boundingBox())!.width)).toBe(control);
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.width), { timeout: 3000 }).toBeGreaterThan(control * 2);
  await expect(sendOf(page).locator(".composer-label")).toBeVisible();
  const revealed = (await sendOf(page).boundingBox())!;
  expect(revealed.x).toBeLessThan(writing.x + writing.width);
  expect(await boxOf(page).boundingBox()).toEqual(writing);
  // The pointer leaves: the icon again.
  await page.mouse.move(writing.x + 20, writing.y + 10);
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.width)).toBe(control);

  // Escape dismisses it while the pointer is still there (WCAG 1.4.13).
  const badge = (await badgeOf(page).boundingBox())!;
  await page.mouse.move(badge.x + badge.width / 2, badge.y + badge.height / 2);
  await expect.poll(async () => Math.round((await badgeOf(page).boundingBox())!.width), { timeout: 3000 }).toBeGreaterThan(control);
  await page.keyboard.press("Escape");
  await expect.poll(async () => Math.round((await badgeOf(page).boundingBox())!.width)).toBe(control);
  await page.mouse.move(writing.x + 20, writing.y + 10);

  // The keyboard's focus shows the words at once.
  await boxOf(page).focus();
  await page.keyboard.press("Tab");
  await expect(badgeOf(page)).toBeFocused();
  await expect.poll(async () => Math.round((await badgeOf(page).boundingBox())!.width)).toBeGreaterThan(control);

  const axe = await new AxeBuilder({ page }).include(".page-conversation-foot").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);

  // Sent, in words again.
  await boxOf(page).focus();
  await page.keyboard.press("Enter");
  await expect(boxOf(page)).toHaveValue("");
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.width)).toBe(Math.round(sendEmpty.width));
});

test("on a phone the badge and Send keep the row under the box, their icons at its right while the Candidate writes (#933)", async ({ page }) => {
  await openConversation(page, PHONE);
  const box = (await boxOf(page).boundingBox())!;
  const send = (await sendOf(page).boundingBox())!;
  expect(send.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  // The badge still opens what says the coach is an AI (AI Act art. 50(1)).
  await badgeOf(page).click();
  await expect(page.getByRole("dialog")).toContainText(fr.coachPanel.aiDisclosure);
  await page.keyboard.press("Escape");

  await boxOf(page).click();
  await page.keyboard.type("Bonjour");
  const control = Math.round(send.height);
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.width)).toBe(control);
  const writing = (await boxOf(page).boundingBox())!;
  const sendWriting = (await sendOf(page).boundingBox())!;
  const badgeWriting = (await badgeOf(page).boundingBox())!;
  expect(sendWriting.y).toBeGreaterThanOrEqual(writing.y + writing.height - 1);
  expect(badgeWriting.x).toBeGreaterThan(writing.x + writing.width / 2);
  const axe = await new AxeBuilder({ page }).include(".page-conversation-foot").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
});
