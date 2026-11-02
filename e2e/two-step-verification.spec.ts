import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { totpAt } from "../apps/web/src/two-step-verification/totp";
import { fromNewAddress, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { emailsTo, linkIn, newAddress } from "./support/mailbox";

// #663, ADR-0075: a Candidate turns on Two-step verification in Mon compte (« Sécurité ») with an authenticator app;
// every sign-in by magic link then asks for a code before anything else, and the server refuses the pending session
// everywhere else.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

async function signOut(page: Page) {
  await page.goto("/compte");
  await page.getByRole("button", { name: fr.nav.account, exact: true }).click();
  await page.getByRole("menuitem", { name: fr.account.signOut }).click();
  await expect(page).toHaveURL(`${origin}/`);
}

/** Signs in by magic link again: the link leads to the second step, the session pending. */
async function signInAgain(page: Page, email: string) {
  const already = emailsTo(email).filter((message) => message.subject === "Votre lien de connexion à Jobbbox").length;
  await fromNewAddress(page);
  await page.goto("/connexion");
  await requestSignInLink(page, email);
  const links = () => emailsTo(email).filter((message) => message.subject === "Votre lien de connexion à Jobbbox");
  await expect.poll(() => links().length).toBeGreaterThan(already);
  await page.goto(linkIn(links()[already]!));
  await expect(page).toHaveURL(/\/connexion\/deuxieme-etape\?suite=%2Fcompte$/);
  await expect(page.getByRole("heading", { level: 1, name: fr.twoStep.secondStep.title })).toBeVisible();
}

test.describe("Two-step verification", () => {
  test("turned on with an authenticator app, it asks a code after each magic link, takes a backup code once, and turns off", async ({ page }) => {
    const email = newAddress("two-step");
    await signInWithMagicLink(page, email);

    // Mon compte, « Sécurité »: the QR code, the key to type, then the app's first code.
    await page.goto("/compte/securite");
    const section = page.getByRole("region", { name: fr.twoStep.security.title });
    await expect(section.getByRole("status")).toHaveText(fr.twoStep.security.off);
    await section.getByRole("button", { name: fr.twoStep.security.enable }).click();
    await expect(section.getByRole("img", { name: fr.twoStep.security.qrLabel })).toBeVisible();
    const secret = (await section.locator("[data-two-step-key]").innerText()).replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await section.getByLabel(fr.twoStep.security.confirmLabel).fill(totpAt(secret, new Date()));
    await section.getByRole("button", { name: fr.twoStep.security.confirm }).click();

    // The 10 backup codes, shown once.
    const codesCard = page.getByRole("region", { name: fr.twoStep.security.codesTitle });
    const codes = await codesCard.locator("[data-backup-codes] li").allInnerTexts();
    expect(codes).toHaveLength(10);
    await expect(codesCard.getByRole("button", { name: fr.twoStep.security.download })).toBeVisible();
    await codesCard.getByRole("button", { name: fr.twoStep.security.done }).click();
    await expect(section.getByRole("status")).toHaveText(/^Activée depuis le /);
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Vérification en deux étapes activée");

    // A magic link now leads to the second step; the pending session reaches nothing else, on the server.
    await signOut(page);
    await signInAgain(page, email);
    const refused = await page.request.get("/api/profiles");
    expect(refused.status()).toBe(401);
    expect(await refused.json()).toEqual({ error: "second_step_required" });
    expect((await page.request.get("/api/auth/get-session")).status()).toBe(401);
    await page.goto("/compte/preferences");
    await expect(page).toHaveURL(/\/connexion\/deuxieme-etape\?suite=%2Fcompte%2Fpreferences$/);

    // A wrong code is refused; the app's next code lets them in, back where they were going.
    await page.getByLabel(fr.twoStep.secondStep.codeLabel).fill("000000");
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(fr.twoStep.secondStep.invalid);
    await page.getByLabel(fr.twoStep.secondStep.codeLabel).fill(totpAt(secret, new Date(Date.now() + 30_000)));
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page).toHaveURL(/\/compte\/preferences$/);
    expect((await page.request.get("/api/profiles")).status()).toBe(200);

    // A backup code works once.
    await signOut(page);
    await signInAgain(page, email);
    await page.getByRole("button", { name: fr.twoStep.secondStep.useBackupCode }).click();
    await page.getByLabel(fr.twoStep.secondStep.backupCodeLabel).fill(codes[0]!);
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page).toHaveURL(/\/compte$/);

    await signOut(page);
    await signInAgain(page, email);
    await page.getByRole("button", { name: fr.twoStep.secondStep.useBackupCode }).click();
    await page.getByLabel(fr.twoStep.secondStep.backupCodeLabel).fill(codes[0]!);
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(fr.twoStep.secondStep.invalid);
    await page.getByLabel(fr.twoStep.secondStep.backupCodeLabel).fill(codes[1]!);
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page).toHaveURL(/\/compte$/);

    // Turned off, a second step having been done less than 10 minutes ago.
    await page.goto("/compte/securite");
    await expect(section.getByText(/8 codes restants/)).toBeVisible();
    await section.getByRole("button", { name: fr.twoStep.security.disable }).click();
    await expect(section.getByRole("status")).toHaveText(fr.twoStep.security.off);
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Vérification en deux étapes désactivée");

    // The next magic link signs straight in.
    await signOut(page);
    await fromNewAddress(page);
    await signInWithMagicLink(page, email);
  });

  test("turning it off or renewing the backup codes asks for a recent second step", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("two-step-recent"));
    // Never turned on: nothing to turn off, but the session has done no second step either.
    expect((await page.request.delete("/api/account/two-step-verification", { headers: { origin } })).status()).toBe(403);
    expect((await page.request.post("/api/account/two-step-verification/backup-codes", { headers: { origin } })).status()).toBe(403);
  });

  test("the account endpoints are for signed-in Candidates only", async ({ request }) => {
    expect((await request.post("/api/account/two-step-verification", { headers: { origin } })).status()).toBe(401);
    expect((await request.post("/api/two-step-verification/second-step", { headers: { origin }, data: { code: "123456" } })).status()).toBe(401);
  });
});
