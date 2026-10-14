import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #125: the AI Coach proposes key facts from a Coach Conversation; the
// Candidate confirms each before it reaches their Coach Memory, which they see,
// edit and delete in the Coach Panel, and which goes with every AI Coach message.
// The AI Coach is faked inside the server (fake-mistral.mjs): it proposes each
// Candidate message as a goal, and says how many Coach Memory items it was told.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const coachPanel = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const messages = (page: Page) => coachPanel(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");

async function askCoach(page: Page, text: string) {
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

async function memoryItems(page: Page): Promise<{ kind: string; text: string }[]> {
  return ((await (await page.request.get("/api/coach/memory")).json()).items as { kind: string; text: string }[]).map(({ kind, text }) => ({ kind, text }));
}

test.describe("Coach Memory", () => {
  test("the Candidate confirms what the AI Coach proposes to remember, then edits and deletes it; it goes with every message", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-memory"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await askCoach(page, "Je vise un poste de DAF à Lyon");
    await expect(messages(page).last()).toHaveText(/Je ne vois aucun profil\. \(1 message\)$/);
    await askCoach(page, "Je ne veux plus travailler dans la banque");
    await expect(messages(page).last()).toHaveText(/\(3 messages\)$/);

    // The AI Coach proposes; nothing is saved yet.
    await coachPanel(page).getByRole("button", { name: fr.coachMemory.propose }).click();
    const proposals = coachPanel(page).getByRole("region", { name: fr.coachMemory.proposalsTitle });
    await expect(proposals.getByRole("heading", { level: 4, name: fr.coachMemory.proposalsTitle })).toBeFocused();
    await expect(proposals.getByRole("article")).toHaveCount(2);
    expect(await memoryItems(page)).toEqual([]);

    // The Candidate confirms one and ignores the other: only the confirmed one is saved.
    await proposals.getByRole("article", { name: /DAF à Lyon/ }).getByRole("button", { name: fr.coachMemory.confirm }).click();
    await expect(coachPanel(page).getByRole("status").filter({ hasText: "Retenu" })).toContainText("Je vise un poste de DAF à Lyon");
    await proposals.getByRole("article", { name: /banque/ }).getByRole("button", { name: fr.coachMemory.dismiss }).click();
    await expect(coachPanel(page).getByText(fr.coachMemory.dismissed)).toBeVisible();
    expect(await memoryItems(page)).toEqual([{ kind: "goal", text: "Je vise un poste de DAF à Lyon" }]);

    // The Coach Memory goes with the next message, in this conversation or a new one.
    await coachPanel(page).getByRole("button", { name: fr.coachPanel.newConversation }).click();
    await askCoach(page, "Par où commencer ?");
    await expect(messages(page).last()).toHaveText(/\(1 message\) Mémoire : 1 élément\.$/);

    // The Candidate sees it in the Coach Panel, and edits its kind and words.
    await coachPanel(page).getByRole("button", { name: fr.coachMemory.open }).click();
    const memory = coachPanel(page).getByRole("region", { name: fr.coachMemory.title });
    await expect(memory.getByRole("heading", { level: 3, name: fr.coachMemory.title })).toBeFocused();
    const item = memory.getByRole("article");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`${fr.coachMemory.kinds.goal} Je vise un poste de DAF à Lyon`);
    await item.getByRole("button", { name: fr.coachMemory.edit }).click();
    await item.getByLabel(fr.coachMemory.kindLabel).selectOption(fr.coachMemory.kinds.decision);
    await item.getByLabel(fr.coachMemory.textLabel).fill("DAF à Lyon ou Grenoble");
    await item.getByRole("button", { name: fr.coachMemory.save }).click();
    await expect(memory.getByRole("status")).toContainText(fr.coachMemory.edited);
    await expect(item).toContainText(`${fr.coachMemory.kinds.decision} DAF à Lyon ou Grenoble`);
    await expect(item.getByRole("button", { name: fr.coachMemory.edit })).toBeFocused();
    expect(await memoryItems(page)).toEqual([{ kind: "decision", text: "DAF à Lyon ou Grenoble" }]);

    // Deleting asks first; then the AI Coach no longer gets it.
    await item.getByRole("button", { name: fr.coachMemory.delete }).click();
    await item.getByRole("button", { name: fr.coachMemory.confirmDeleteButton }).click();
    await expect(memory.getByRole("status")).toContainText(fr.coachMemory.deleted);
    await expect(memory).toContainText(fr.coachMemory.empty);
    expect(await memoryItems(page)).toEqual([]);
    await coachPanel(page).getByRole("button", { name: fr.coachPanel.backToConversation }).click();
    await askCoach(page, "Et ensuite ?");
    await expect(messages(page).last()).toHaveText(/\(3 messages\)$/);
  });

  test("refuses anonymous visitors and other sites, and never shows or changes another Candidate's Coach Memory", async ({ page, browser }) => {
    expect((await page.request.get("/api/coach/memory")).status()).toBe(401);
    expect((await page.request.post("/api/coach/memory", { headers: { origin }, data: { kind: "goal", text: "Lyon" } })).status()).toBe(401);

    await signInWithMagicLink(page, newAddress("coach-memory-owner"));
    const saved = await page.request.post("/api/coach/memory", { headers: { origin }, data: { kind: "goal", text: "Poste de DAF à Lyon" } });
    expect(saved.status()).toBe(201);
    const { item } = await saved.json();
    expect((await page.request.post("/api/coach/memory", { headers: { origin: "https://evil.example" }, data: { kind: "goal", text: "x" } })).status()).toBe(403);
    expect((await page.request.post("/api/coach/memory", { headers: { origin }, data: { kind: "goal", text: "" } })).status()).toBe(400);

    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("coach-memory-other"));
    expect((await (await other.request.get("/api/coach/memory")).json()).items).toEqual([]);
    expect((await other.request.patch(`/api/coach/memory/${item.id}`, { headers: { origin }, data: { kind: "goal", text: "Pris" } })).status()).toBe(404);
    expect((await other.request.delete(`/api/coach/memory/${item.id}`, { headers: { origin } })).status()).toBe(404);
    const conversation = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Bonjour" } });
    const { conversation: started } = await conversation.json();
    expect((await other.request.post("/api/coach/memory/proposals", { headers: { origin }, data: { conversationId: started.id } })).status()).toBe(404);
    await other.close();

    expect(await memoryItems(page)).toEqual([{ kind: "goal", text: "Poste de DAF à Lyon" }]);
  });

  test("meets the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-memory-floor"));
    await page.request.post("/api/coach/memory", { headers: { origin }, data: { kind: "constraint", text: "Pas plus de 2 jours de déplacement par mois" } });
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await coachPanel(page).getByRole("button", { name: fr.coachMemory.open }).click();
    const memory = coachPanel(page).getByRole("region", { name: fr.coachMemory.title });
    await memory.getByRole("button", { name: fr.coachMemory.delete }).click();
    await expect(memory.getByRole("button", { name: fr.coachMemory.confirmDeleteButton })).toBeVisible();
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
