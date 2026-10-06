import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { approveAtGoogle, refuseAtGoogle, signInWithMagicLink } from "./support/candidate";
import { emailsTo, linkIn, newAddress, waitForEmail } from "./support/mailbox";

// Issue #2: passwordless sign-up / sign-in and the Candidate account, through
// the web app's pages and its /api/auth HTTP API.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

test.describe("magic-link sign-up and sign-in", () => {
  test("a new person signs up with only their email and lands on their account, in French", async ({ page }) => {
    const email = newAddress("marie.dupont");
    await page.goto("/");
    await page.getByRole("link", { name: fr.nav.signIn }).click();
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page).toHaveTitle(`${fr.signIn.title} · ${fr.app.name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.signIn.title);
    await expect(page.getByLabel(/mot de passe/i)).toHaveCount(0);

    await page.getByLabel(fr.signIn.emailLabel).fill(email);
    await page.getByRole("button", { name: fr.signIn.submit }).click();
    await expect(page.getByRole("status")).toHaveText(fr.signIn.sent);

    const message = await waitForEmail(email);
    expect(message.subject).toBe(fr.signInEmail.subject);
    expect(message.text).toContain("15 minutes");
    const link = linkIn(message);
    expect(link.startsWith(`${origin}/`)).toBe(true);

    await page.goto(link);
    await expect(page).toHaveURL(`${origin}/compte`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.account.title);
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByLabel(fr.account.interfaceLanguage)).toHaveValue("fr");

    // The home page now leads to the account instead of sign-in.
    await page.goto("/");
    await expect(page.getByRole("link", { name: fr.nav.account })).toHaveAttribute("href", "/compte");
  });

  test("the sign-in and account pages use only catalogue strings and meet the ADR-0009 floor", async ({ page }) => {
    const allowed = new Set(catalogueStrings(fr));
    const email = newAddress("floor");
    await page.goto("/connexion");
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
    await signInWithMagicLink(page, email);
    for (const t of await renderedTexts(page)) {
      if (t.text === email) continue;
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("a sign-in link works only once", async ({ page, browser }) => {
    const email = newAddress("once");
    const message = await signInWithMagicLink(page, email);

    const someoneElse = await browser.newContext({ baseURL: origin });
    const replay = await someoneElse.newPage();
    await replay.goto(linkIn(message));
    await expect(replay).toHaveURL(/\/connexion\?error=/);
    await expect(replay.getByRole("alert").filter({ hasText: fr.signIn.linkError })).toBeVisible();
    await replay.goto("/compte");
    await expect(replay).toHaveURL(/\/connexion$/);
    await someoneElse.close();
  });

  test("a returning Candidate signs back into the same account", async ({ page, browser }) => {
    const email = newAddress("returning");
    await signInWithMagicLink(page, email);
    const first = await (await page.request.get("/api/auth/get-session")).json();

    const later = await browser.newContext({ baseURL: origin });
    const again = await later.newPage();
    await signInWithMagicLink(again, email);
    const second = await (await again.request.get("/api/auth/get-session")).json();
    expect(second.user.id).toBe(first.user.id);
    expect(emailsTo(email)).toHaveLength(2);
    await later.close();
  });

  test("the account page is for signed-in Candidates only, and signing out ends the session", async ({ page }) => {
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion$/);

    await signInWithMagicLink(page, newAddress("leaving"));
    await page.getByRole("button", { name: fr.account.signOut }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole("link", { name: fr.nav.signIn })).toBeVisible();
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion$/);
  });
});

test.describe("Google sign-in", () => {
  test("a new person signs up with Google and lands on their account", async ({ page }) => {
    const email = newAddress("jean.martin");
    await approveAtGoogle(page, { sub: `google-${email}`, email, email_verified: true, name: "Jean Martin" }, origin);

    await page.goto("/connexion");
    await page.getByRole("button", { name: fr.signIn.google }).click();

    await expect(page).toHaveURL(`${origin}/compte`);
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByLabel(fr.account.interfaceLanguage)).toHaveValue("fr");
    const session = await (await page.request.get("/api/auth/get-session")).json();
    expect(session.user).toMatchObject({ email, name: "Jean Martin", interfaceLanguage: "fr" });
  });

  test("a Candidate who signed up by email reaches the same account with Google", async ({ page, browser }) => {
    const email = newAddress("both.ways");
    await signInWithMagicLink(page, email);
    const viaEmail = await (await page.request.get("/api/auth/get-session")).json();

    const other = await browser.newContext({ baseURL: origin });
    const viaGooglePage = await other.newPage();
    await approveAtGoogle(viaGooglePage, { sub: `google-${email}`, email, email_verified: true, name: "Both Ways" }, origin);
    await viaGooglePage.goto("/connexion");
    await viaGooglePage.getByRole("button", { name: fr.signIn.google }).click();
    await expect(viaGooglePage).toHaveURL(`${origin}/compte`);
    const viaGoogle = await (await viaGooglePage.request.get("/api/auth/get-session")).json();
    expect(viaGoogle.user.id).toBe(viaEmail.user.id);
    await other.close();
  });

  test("a person who cancels at Google comes back to the sign-in page, in French", async ({ page }) => {
    await refuseAtGoogle(page, origin);

    await page.goto("/connexion");
    await page.getByRole("button", { name: fr.signIn.google }).click();

    await expect(page).toHaveURL(/\/connexion\?error=access_denied$/);
    await expect(page.getByRole("alert").filter({ hasText: fr.signIn.failed })).toBeVisible();
    await expect(page.getByRole("button", { name: fr.signIn.google })).toBeVisible();
  });

  test("a Google callback that matches no sign-in lands on the sign-in page, not an English error page", async ({ page }) => {
    await page.goto("/api/auth/callback/google?error=access_denied&state=abc");

    await expect(page).toHaveURL(/\/connexion\?error=/);
    await expect(page.getByRole("alert").filter({ hasText: fr.signIn.failed })).toBeVisible();
  });
});

test.describe("Interface Language", () => {
  test("defaults to French, can be switched to English, and follows the Candidate", async ({ page }) => {
    const email = newAddress("language");
    await signInWithMagicLink(page, email);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const select = page.getByLabel(fr.account.interfaceLanguage);
    await expect(select).toHaveValue("fr");
    await expect(select.locator("option")).toHaveText([fr.languages.fr, fr.languages.en]);

    await select.selectOption("en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.account.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("status")).toHaveText(en.account.saved);

    // Stored on the Candidate, not the browser: survives a reload and shows everywhere.
    await page.reload();
    await expect(page.getByLabel(en.account.interfaceLanguage)).toHaveValue("en");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.home.title);

    // Signed out, visitors get French again; the next sign-in email is in English.
    await page.goto("/compte");
    await page.getByRole("button", { name: en.account.signOut }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.home.title);
    const message = await signInWithMagicLink(page, email);
    expect(message.subject).toBe(en.signInEmail.subject);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("only supported languages are accepted", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("unsupported"));
    const response = await page.request.post("/api/auth/update-user", {
      data: { interfaceLanguage: "de" },
      headers: { origin },
    });
    expect(response.status()).toBe(400);
    const session = await (await page.request.get("/api/auth/get-session")).json();
    expect(session.user.interfaceLanguage).toBe("fr");
  });
});
