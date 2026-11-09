import { readFileSync } from "node:fs";
import { API_VERSION, API_VERSION_HEADER } from "@jobhub/shared";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import pg from "pg";
import { totpAt } from "../apps/web/src/two-step-verification/totp";
import { approveAtGoogle, fromNewAddress, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { emailsTo, linkIn, newAddress } from "./support/mailbox";
import { accountButtonName } from "./support/account-menu";

// #663, #664, ADR-0075: a Candidate turns on Two-step verification in Mon compte (« Sécurité ») with an authenticator app
// or a passkey; every sign-in by magic link then asks for a second step before anything else, and the server refuses the
// pending session everywhere else. Passkeys are made by Chromium's virtual WebAuthn authenticator (DevTools Protocol).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(async () => {
  await database.end();
});
const secondStepCalls = async () => Number((await database.query(`SELECT count(*) FROM external_api_usage WHERE provider = 'two_step_verification' AND operation = 'second_step'`)).rows[0].count);

/** Turns Two-step verification on from Mon compte, as a signed-in Candidate; returns the key and the 10 backup codes. */
async function turnOn(page: Page) {
  await page.goto("/compte/securite");
  const section = page.getByRole("region", { name: fr.twoStep.security.title });
  await section.getByRole("button", { name: fr.twoStep.security.enable }).click();
  const secret = (await section.locator("[data-two-step-key]").innerText()).replace(/\s/g, "");
  await section.getByLabel(fr.twoStep.security.confirmLabel).fill(totpAt(secret, new Date()));
  await section.getByRole("button", { name: fr.twoStep.security.confirm }).click();
  const codesCard = page.getByRole("region", { name: fr.twoStep.security.codesTitle });
  // The card shows once the server confirmed the code; allInnerTexts does not wait for it.
  await expect(codesCard.locator("[data-backup-codes] li")).toHaveCount(10);
  const codes = await codesCard.locator("[data-backup-codes] li").allInnerTexts();
  await codesCard.getByRole("button", { name: fr.twoStep.security.done }).click();
  await expect(section.getByRole("status")).toHaveText(/^Activée depuis le /);
  return { secret, codes };
}

async function signOut(page: Page) {
  await page.goto("/compte");
  await page.getByRole("button", { name: accountButtonName(fr.nav.account) }).click();
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

/**
 * Gives `page` a passkey device: Chromium's virtual authenticator (a platform one, like Touch ID or Windows Hello), which
 * creates and uses passkeys with no one to touch it.
 */
async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
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
    // The card shows once the server confirmed the code; allInnerTexts does not wait for it.
    await expect(codesCard.locator("[data-backup-codes] li")).toHaveCount(10);
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
    await expect(page.getByRole("alert").filter({ hasText: fr.twoStep.secondStep.invalid })).toBeVisible();
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
    await expect(page.getByRole("alert").filter({ hasText: fr.twoStep.secondStep.invalid })).toBeVisible();
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

  test("five wrong codes lock the second step for a while, each failure counted without the code; the extension's requests are refused too", async ({ page }) => {
    const email = newAddress("two-step-lock");
    await signInWithMagicLink(page, email);
    const { secret } = await turnOn(page);
    await signOut(page);
    await signInAgain(page, email);

    // The extension (a trusted origin) asks with the same pending session: 401 and the stable code.
    const extensionOrigin = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;
    const fromExtension = await page.request.get("/api/profiles", { headers: { origin: extensionOrigin, [API_VERSION_HEADER]: String(API_VERSION) } });
    expect(fromExtension.status()).toBe(401);
    expect(await fromExtension.json()).toEqual({ error: "second_step_required" });

    const before = await secondStepCalls();
    const wrong = totpAt(secret, new Date(Date.now() + 10 * 60_000)); // another window's code, valid for no one now
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByLabel(fr.twoStep.secondStep.codeLabel).fill(wrong);
      await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
      await expect(page.getByRole("alert").filter({ hasText: attempt < 4 ? fr.twoStep.secondStep.invalid : "Trop de codes erronés" })).toBeVisible();
    }
    expect(await secondStepCalls()).toBe(before + 5);
    const logged = await database.query(`SELECT * FROM external_api_usage WHERE provider = 'two_step_verification' ORDER BY id DESC LIMIT 5`);
    expect(JSON.stringify(logged.rows)).not.toContain(wrong);

    // Locked: even the right code is refused, and the session stays pending.
    await page.getByLabel(fr.twoStep.secondStep.codeLabel).fill(totpAt(secret, new Date()));
    await page.getByRole("button", { name: fr.twoStep.secondStep.submit }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Trop de codes erronés" })).toBeVisible();
    expect((await page.request.get("/api/profiles")).status()).toBe(401);
  });

  test("the Data export tells the state and the factors, never the secret nor a backup code", async ({ page }) => {
    const email = newAddress("two-step-export");
    await signInWithMagicLink(page, email);
    const { secret, codes } = await turnOn(page);
    const response = await page.request.get("/api/account/export");
    expect(response.status()).toBe(200);
    const text = await response.text();
    const exported = JSON.parse(text);
    expect(exported.twoStepVerification.enabledAt).toBeTruthy();
    expect(exported.twoStepVerification.backupCodesLeft).toBe(10);
    expect(exported.twoStepVerification.factors.map((factor: { kind: string }) => factor.kind)).toEqual(["authenticator_app", "backup_codes"]);
    for (const factor of exported.twoStepVerification.factors) expect(Object.keys(factor).sort()).toEqual(["addedAt", "kind", "lastUsedAt"]);
    expect(text).not.toContain(secret);
    for (const code of codes) expect(text).not.toContain(code);
  });

  test("a Sign-in Provider's sign-in never leaves the session pending, and the change email speaks the interface language", async ({ page }) => {
    const email = newAddress("two-step-google");
    await signInWithMagicLink(page, email);
    await page.goto("/compte/preferences");
    await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/compte/securite");
    const section = page.getByRole("region", { name: "Two-step verification" });
    await section.getByRole("button", { name: "Turn on with an app" }).click();
    const secret = (await section.locator("[data-two-step-key]").innerText()).replace(/\s/g, "");
    await section.getByRole("textbox").fill(totpAt(secret, new Date()));
    await section.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Two-step verification turned on");

    await page.context().clearCookies();
    await approveAtGoogle(page, { sub: `google-${email}`, email, email_verified: true, name: "Via Google" }, origin);
    await page.goto("/connexion");
    await page.getByRole("button", { name: /Google/ }).click();
    await expect(page).toHaveURL(`${origin}/compte`);
    expect((await page.request.get("/api/profiles")).status()).toBe(200);
  });

  test("signing in with a passkey alone, without a magic link, is not served: the plugin's sign-in endpoints are refused", async ({ request }) => {
    const options = await request.get("/api/auth/passkey/generate-authenticate-options", { headers: { origin } });
    expect(options.status()).toBe(404);
    for (const path of ["verify-authentication", "delete-passkey"]) {
      const refused = await request.post(`/api/auth/passkey/${path}`, { headers: { origin }, data: { response: { id: "x" }, id: "x" } });
      expect(refused.status()).toBe(404);
    }
    expect((await request.get("/api/profiles")).status()).toBe(401);
  });

  test("turned on with a passkey alone: added and renamed in Mon compte, it is the second step after a magic link, and removing it turns the verification off", async ({ page }) => {
    const email = newAddress("two-step-passkey");
    await signInWithMagicLink(page, email);
    await virtualAuthenticator(page);

    // Mon compte, « Sécurité »: a passkey, named, turns it on, with the 10 backup codes shown once.
    await page.goto("/compte/securite");
    const section = page.getByRole("region", { name: fr.twoStep.security.title });
    await section.getByRole("button", { name: fr.twoStep.passkeys.enable }).click();
    const adding = page.getByRole("region", { name: fr.twoStep.passkeys.addTitle });
    await adding.getByLabel(fr.twoStep.passkeys.nameLabel).fill("Ordinateur de test");
    await adding.getByRole("button", { name: fr.twoStep.passkeys.add }).click();
    const codesCard = page.getByRole("region", { name: fr.twoStep.security.codesTitle });
    await expect(codesCard.locator("[data-backup-codes] li")).toHaveCount(10);
    await codesCard.getByRole("button", { name: fr.twoStep.security.done }).click();
    await expect(section.getByRole("status")).toHaveText(/^Activée depuis le /);
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Vérification en deux étapes activée");
    const passkeyRow = section.locator("[data-passkey]");
    await expect(passkeyRow).toHaveCount(1);
    await expect(passkeyRow).toContainText("Ordinateur de test");
    await expect(passkeyRow).toContainText(/ajoutée le .* jamais utilisée/);

    // Renamed.
    await section.getByRole("button", { name: "Renommer la clé d'accès « Ordinateur de test »" }).click();
    await section.getByLabel(fr.twoStep.passkeys.nameLabel).fill("Clé virtuelle");
    await section.getByRole("button", { name: fr.twoStep.passkeys.save }).click();
    await expect(passkeyRow).toContainText("Clé virtuelle");

    // The Data export lists it, never its public key.
    const exported = await (await page.request.get("/api/account/export")).json();
    const passkeyFactor = exported.twoStepVerification.factors.find((factor: { kind: string }) => factor.kind === "passkey");
    expect(Object.keys(passkeyFactor).sort()).toEqual(["addedAt", "device", "id", "kind", "lastUsedAt", "name"]);
    expect(passkeyFactor.name).toBe("Clé virtuelle");
    const { rows } = await database.query(`SELECT "publicKey" FROM passkey WHERE id = $1`, [passkeyFactor.id]);
    expect(JSON.stringify(exported)).not.toContain(rows[0].publicKey);

    // A magic link now leads to the second step, which offers the passkey. An answer that is not one of the account's
    // passkeys is refused, and the session stays pending.
    await signOut(page);
    await signInAgain(page, email);
    expect((await page.request.post("/api/two-step-verification/second-step/passkey", { headers: { origin }, data: {} })).status()).toBe(200);
    const forged = await page.request.post("/api/two-step-verification/second-step/passkey", { headers: { origin }, data: { response: { id: "not-a-passkey-of-this-account" } } });
    expect(forged.status()).toBe(400);
    expect(await forged.json()).toEqual({ error: "invalid_passkey" });
    expect((await page.request.get("/api/profiles")).status()).toBe(401);
    await page.getByRole("button", { name: fr.twoStep.passkeys.use }).click();
    await expect(page).toHaveURL(/\/compte$/);
    expect((await page.request.get("/api/profiles")).status()).toBe(200);

    // Removing the last factor asks for a second step done less than 10 minutes ago (here, aged), then turns it off.
    await page.goto("/compte/securite");
    await expect(passkeyRow).toContainText(/dernière utilisation le/);
    await database.query(`UPDATE session SET "twoStepVerifiedAt" = now() - interval '11 minutes' WHERE "userId" = (SELECT id FROM candidate WHERE email = $1)`, [email]);
    await section.getByRole("button", { name: "Supprimer la clé d'accès « Clé virtuelle »" }).click();
    await expect(section.getByText(fr.twoStep.passkeys.confirmIdentity)).toBeVisible();
    await section.getByRole("button", { name: fr.twoStep.passkeys.use }).click();
    await expect(section.getByRole("status")).toHaveText(fr.twoStep.security.off);
    await expect(section.locator("[data-passkey]")).toHaveCount(0);
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Vérification en deux étapes désactivée");

    // The next magic link signs straight in.
    await signOut(page);
    await fromNewAddress(page);
    await signInWithMagicLink(page, email);
  });
});
