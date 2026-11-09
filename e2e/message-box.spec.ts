import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { conversationOf, toConversation } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #933: the conversation's message box starts on one line and grows with the text, up to about 8 lines, then
// scrolls inside; sent, it is one line again. On a computer the « Coach IA » badge and « Envoyer au coach » stand on its
// row, so the box is one line; on a phone they keep the row under it. Enter sends, Shift+Enter starts a line, as before.
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

test("on a computer the « Coach IA » badge and Send stand on the box's row, on its last line as it grows (#933)", async ({ page }) => {
  await openConversation(page, COMPUTER);
  const box = (await boxOf(page).boundingBox())!;
  const send = (await sendOf(page).boundingBox())!;
  const badge = (await badgeOf(page).boundingBox())!;
  // At the box's right, on its row.
  expect(badge.x).toBeGreaterThan(box.x + box.width - 1);
  expect(send.x).toBeGreaterThan(badge.x);
  expect(Math.round(send.y)).toBe(Math.round(box.y));

  await writeLines(page, 3);
  await expect.poll(async () => Math.round((await boxOf(page).boundingBox())!.height)).toBeGreaterThan(Math.round(box.height));
  const grown = (await boxOf(page).boundingBox())!;
  const sendAfter = (await sendOf(page).boundingBox())!;
  expect(Math.round(sendAfter.y + sendAfter.height)).toBe(Math.round(grown.y + grown.height));
});

test("on a phone the « Coach IA » badge and Send keep the row under the box (#933)", async ({ page }) => {
  await openConversation(page, PHONE);
  const box = (await boxOf(page).boundingBox())!;
  const send = (await sendOf(page).boundingBox())!;
  expect(send.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  // The badge still opens what says the coach is an AI (AI Act art. 50(1)).
  await badgeOf(page).click();
  await expect(page.getByRole("dialog")).toContainText(fr.coachPanel.aiDisclosure);
});
