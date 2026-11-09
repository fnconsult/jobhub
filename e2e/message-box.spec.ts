import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { conversationOf, toConversation } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #933: the conversation's message box starts on one line and grows with the text, up to about 8 lines, then
// scrolls inside; sent, it is one line again. On a computer the « Coach IA » badge and « Envoyer au coach » stand on its
// row, so the box is one line; past one line the text takes the whole width, the two at the right under it; on a phone
// they keep the row under it. Enter sends, Shift+Enter starts a line, as before.
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

test("on a computer the « Coach IA » badge and Send stand on the box's row; past one line, the text takes the whole width, both at the right under it (#933)", async ({ page }) => {
  await openConversation(page, COMPUTER);
  const box = (await boxOf(page).boundingBox())!;
  const send = (await sendOf(page).boundingBox())!;
  const badge = (await badgeOf(page).boundingBox())!;
  // At the box's right, on its row.
  expect(badge.x).toBeGreaterThan(box.x + box.width - 1);
  expect(send.x).toBeGreaterThan(badge.x);
  expect(Math.round(send.y)).toBe(Math.round(box.y));

  // A line long enough to wrap beside them: the text takes the whole width, the badge and Send under it, at the right.
  await boxOf(page).click();
  await page.keyboard.type("Je prépare un entretien pour un poste de Head of Business Unit Professional Services chez Canal+ la semaine prochaine.");
  await expect(boxOf(page)).toHaveAttribute("data-multiline", "");
  const wide = (await boxOf(page).boundingBox())!;
  const sendUnder = (await sendOf(page).boundingBox())!;
  const badgeUnder = (await badgeOf(page).boundingBox())!;
  expect(wide.width).toBeGreaterThan(box.width + badge.width + send.width);
  expect(sendUnder.y).toBeGreaterThanOrEqual(wide.y + wide.height - 1);
  expect(Math.round(sendUnder.x + sendUnder.width)).toBe(Math.round(wide.x + wide.width));
  expect(badgeUnder.x).toBeGreaterThan(wide.x + wide.width / 2);
  // On one row: their middles level.
  expect(Math.abs(badgeUnder.y + badgeUnder.height / 2 - (sendUnder.y + sendUnder.height / 2))).toBeLessThan(2);

  // Shortened again while writing, it stays so; sent, it is one line again, the badge and Send back on its row.
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Bonjour");
  await expect(boxOf(page)).toHaveAttribute("data-multiline", "");
  await page.keyboard.press("Enter");
  await expect(boxOf(page)).toHaveValue("");
  await expect(boxOf(page)).not.toHaveAttribute("data-multiline");
  await expect.poll(async () => Math.round((await sendOf(page).boundingBox())!.y)).toBe(Math.round(box.y));
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
