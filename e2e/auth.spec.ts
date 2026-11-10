import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fromCatalogue, renderedTexts } from "./support/accessibility";
import { approveAtGoogle, fromNewAddress, refuseAtGoogle, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { codeIn, emailsTo, linkIn, newAddress, waitForEmail } from "./support/mailbox";
import { startServer } from "./support/plan-prices";
import { accountButtonName } from "./support/account-menu";

// Issue #2: passwordless sign-up / sign-in and the Candidate account, through
// the web app's pages and its /api/auth HTTP API.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// The suite's server has env's Google client, seeded as a Sign-in Provider by the migration (#209).
const continueWithGoogle = fr.signIn.continueWith.replace("{{provider}}", "Google");
const introWithGoogle = fr.signIn.intro.replace("{{providers}}", "Google");
const failedWithGoogle = fr.signIn.failed.replace("{{providers}}", "Google");

test.describe("magic-link sign-up and sign-in", () => {
  test("a new person signs up with only their email and lands on their account, in French", async ({ page }) => {
    const email = newAddress("marie.dupont");
    await page.goto("/");
    await page.getByRole("link", { name: fr.nav.signIn }).click();
    await expect(page).toHaveURL(/\/connexion(\?|$)/);
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
    // The address is in Mon compte's Sign-in Section, the language in its Preferences (ADR-0024).
    await page.goto("/compte/connexion");
    await expect(page.getByText(email)).toBeVisible();
    await page.goto("/compte/preferences");
    await expect(page.getByLabel(fr.account.interfaceLanguage)).toHaveValue("fr");

    // The home page now leads to the account instead of sign-in.
    await page.goto("/");
    await page.getByRole("button", { name: accountButtonName(fr.nav.account) }).click();
    await expect(page.getByRole("menuitem", { name: fr.nav.account })).toHaveAttribute("href", "/compte");
  });

  test("the sign-in and account pages use only catalogue strings and meet the ADR-0009 floor", async ({ page }) => {
    // Some account-page strings carry a value, e.g. the Follow-up Delays hint (issue #21).
    const known = fromCatalogue(fr);
    // The Usage Meter's percentage, a catalogue string with the week's number in it.
    const meter = fr.usageMeter.percent.replace("{{percent}}", "0");
    const allowed = { has: (text: string) => text === meter || known(text) };
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
    await expect(replay).toHaveURL(/\/connexion(\?|$)/);
    await someoneElse.close();
  });

  // #570: a Visitor reading the site in English signs up in English: their sign-in email, then their account. A
  // returning Candidate's link keeps their own Interface Language, whatever the page's.
  test("a new person who signs up from the English sign-in page gets the email and the account in English", async ({ page, browser }) => {
    const email = newAddress("claire.english");
    await page.goto("/en");
    await page.getByRole("link", { name: en.nav.signIn }).click();
    await expect(page).toHaveURL(/\/en\/connexion$/);
    await page.getByLabel(en.signIn.emailLabel).fill(email);
    await page.getByRole("button", { name: en.signIn.submit }).click();
    await expect(page.getByRole("status")).toHaveText(en.signIn.sent);

    const message = await waitForEmail(email);
    expect(message.subject).toBe(en.signInEmail.subject);
    await page.goto(linkIn(message));
    await expect(page).toHaveURL(`${origin}/compte`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.account.title);
    await page.goto("/compte/preferences");
    await expect(page.getByLabel(en.account.interfaceLanguage)).toHaveValue("en");

    // Back on the French sign-in page, the same Candidate's email stays in their English, and so does the account.
    const later = await browser.newContext({ baseURL: origin });
    const again = await later.newPage();
    await again.goto("/connexion");
    await again.getByLabel(fr.signIn.emailLabel).fill(email);
    await again.getByRole("button", { name: fr.signIn.submit }).click();
    await expect(again.getByRole("status")).toHaveText(fr.signIn.sent);
    const second = await waitForEmail(email, 1);
    expect(second.subject).toBe(en.signInEmail.subject);
    expect(linkIn(second)).not.toContain("interfaceLanguage");
    await later.close();
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
    await expect(page).toHaveURL(/\/connexion(\?|$)/);

    await signInWithMagicLink(page, newAddress("leaving"));
    await page.getByRole("button", { name: accountButtonName(fr.nav.account) }).click();
    await page.getByRole("menuitem", { name: fr.account.signOut }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole("link", { name: fr.nav.signIn })).toBeVisible();
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion(\?|$)/);
  });
});

// Issue #686: the sign-in email's code, typed on the page that waits for the link.
test.describe("the sign-in email's code", () => {
  /** Asks the sign-in email for `email` on the sign-in page, as a person does; returns it. The page waits for its link. */
  async function askEmail(page: Page, email: string) {
    const already = emailsTo(email).length;
    await fromNewAddress(page);
    await page.goto("/connexion");
    await requestSignInLink(page, email);
    return waitForEmail(email, already);
  }

  /** Types `code` in the waiting page's field and submits it, waiting for the web app's answer. */
  async function enterCode(page: Page, code: string) {
    await page.getByLabel(fr.signIn.codeLabel).fill(code);
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/sign-in/email-otp");
    await page.getByRole("button", { name: fr.signIn.codeSubmit }).click();
    return answered;
  }

  test("signs in with the code typed on the page waiting for the link", async ({ page }) => {
    const email = newAddress("code");
    const message = await askEmail(page, email);
    await expect(page.getByRole("status")).toHaveText(fr.signIn.sent);
    const field = page.getByLabel(fr.signIn.codeLabel);
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await expect(field).toHaveAttribute("inputmode", "numeric");

    expect(message.text).toContain(fr.signInEmail.code.replace("{{code}}", codeIn(message)));
    await enterCode(page, codeIn(message));

    await expect(page).toHaveURL(`${origin}/compte`);
    expect((await (await page.request.get("/api/auth/get-session")).json()).user.email).toBe(email);
    // The code spent its link.
    await page.context().clearCookies();
    await page.goto(linkIn(message));
    await expect(page).toHaveURL(/\/connexion\?error=/);
  });

  test("refuses a wrong code 5 times, then the right one too, until a new email is asked, offered until then", async ({ page }) => {
    const email = newAddress("code-tries");
    const code = codeIn(await askEmail(page, email));
    const wrong = code === "000000" ? "111111" : "000000";

    for (let tries = 0; tries < 5; tries++) {
      expect((await enterCode(page, wrong)).status()).toBe(400);
      await expect(page.getByRole("alert").filter({ hasText: fr.signIn.codeWrong })).toBeVisible();
    }
    expect((await enterCode(page, code)).status()).toBe(403);
    await expect(page.getByRole("alert").filter({ hasText: fr.signIn.codeTooManyTries })).toBeVisible();
    expect((await (await page.request.get("/api/auth/get-session")).json())?.user).toBeUndefined();
    const resend = page.getByRole("button", { name: fr.signIn.resend });
    await expect(resend).toBeVisible();

    // #755: the code is gone, so the next one typed is refused as wrong; the new email is still offered.
    expect((await enterCode(page, code)).status()).toBe(400);
    await expect(page.getByRole("alert").filter({ hasText: fr.signIn.codeWrong })).toBeVisible();
    await expect(resend).toBeVisible();

    await resend.click();
    const next = await waitForEmail(email, 1);
    await enterCode(page, codeIn(next));
    await expect(page).toHaveURL(`${origin}/compte`);
  });

  test("the link spends the code: the same email's code is refused after its link signed in", async ({ page, browser }) => {
    const email = newAddress("link-spends-code");
    const message = await askEmail(page, email);
    await page.goto(linkIn(message));
    await expect(page).toHaveURL(`${origin}/compte`);

    const someoneElse = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.68.6.2" } });
    const refused = await someoneElse.request.post("/api/auth/sign-in/email-otp", { data: { email, otp: codeIn(message) }, headers: { origin } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe("INVALID_OTP");
    await someoneElse.close();
  });

  test("refuses a code already used", async ({ page, browser }) => {
    const email = newAddress("code-once");
    const code = codeIn(await askEmail(page, email));
    await enterCode(page, code);
    await expect(page).toHaveURL(`${origin}/compte`);

    // The same code, typed again on another device.
    const someoneElse = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.68.6.1" } });
    const replayed = await someoneElse.request.post("/api/auth/sign-in/email-otp", { data: { email, otp: code }, headers: { origin } });
    expect(replayed.status()).toBe(400);
    expect((await replayed.json()).code).toBe("INVALID_OTP");
    const replay = await someoneElse.newPage();
    await replay.goto("/compte");
    await expect(replay).toHaveURL(/\/connexion(\?|$)/);
    await someoneElse.close();
  });
});

test.describe("Google sign-in", () => {
  test("a new person signs up with Google and lands on their account", async ({ page }) => {
    const email = newAddress("jean.martin");
    await approveAtGoogle(page, { sub: `google-${email}`, email, email_verified: true, name: "Jean Martin" }, origin);

    await page.goto("/connexion");
    await page.getByRole("button", { name: continueWithGoogle }).click();

    await expect(page).toHaveURL(`${origin}/compte`);
    await page.goto("/compte/connexion");
    await expect(page.getByText(email)).toBeVisible();
    await page.goto("/compte/preferences");
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
    await viaGooglePage.getByRole("button", { name: continueWithGoogle }).click();
    await expect(viaGooglePage).toHaveURL(`${origin}/compte`);
    const viaGoogle = await (await viaGooglePage.request.get("/api/auth/get-session")).json();
    expect(viaGoogle.user.id).toBe(viaEmail.user.id);
    await other.close();
  });

  test("a person who cancels at Google comes back to the sign-in page, in French", async ({ page }) => {
    await refuseAtGoogle(page, origin);

    await page.goto("/connexion");
    await page.getByRole("button", { name: continueWithGoogle }).click();

    await expect(page).toHaveURL(/\/connexion\?error=access_denied$/);
    await expect(page.getByRole("alert").filter({ hasText: failedWithGoogle })).toBeVisible();
    await expect(page.getByRole("button", { name: continueWithGoogle })).toBeVisible();
  });

  test("a Google callback that matches no sign-in lands on the sign-in page, not an English error page", async ({ page }) => {
    await page.goto("/api/auth/callback/google?error=access_denied&state=abc");

    await expect(page).toHaveURL(/\/connexion\?error=/);
    await expect(page.getByRole("alert").filter({ hasText: failedWithGoogle })).toBeVisible();
  });
});

test.describe("Interface Language", () => {
  test("defaults to French, can be switched to English, and follows the Candidate", async ({ page }) => {
    const email = newAddress("language");
    await signInWithMagicLink(page, email);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await page.goto("/compte/preferences");
    const select = page.getByLabel(fr.account.interfaceLanguage);
    await expect(select).toHaveValue("fr");
    await expect(select.locator("option")).toHaveText([fr.languages.fr, fr.languages.en]);

    await select.selectOption("en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.account.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("status").filter({ hasText: en.account.saved })).toHaveText(en.account.saved);

    // Stored on the Candidate, not the browser: survives a reload and shows everywhere.
    await page.reload();
    await expect(page.getByLabel(en.account.interfaceLanguage)).toHaveValue("en");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.conversationFirst.newConversation);

    // Signed out, visitors get French again; the next sign-in email is in English.
    await page.goto("/compte");
    await page.getByRole("button", { name: accountButtonName(en.nav.account) }).click();
    await page.getByRole("menuitem", { name: en.account.signOut }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.home.title);
    const message = await signInWithMagicLink(page, email);
    expect(message.subject).toBe(en.signInEmail.subject);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  // #446: picked from the server's HTML, before React had attached its handler, the choice was lost and the page
  // stayed French. The page's scripts are held back here, so the select is reached while the page is still loading.
  test("picked while the page is still loading, English still takes", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("language-early"));
    await page.route("**/_next/static/chunks/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await page.goto("/compte/preferences", { waitUntil: "commit" });
    await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 15_000 });
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

// Issue #170: the sign-in page's text mentions Google only when Google sign-in is configured.
// The suite's server has Google configured; a second build of the app has it unset.
test.describe("sign-in page text and Google sign-in", () => {
  test("with Google sign-in configured, the text and the button still mention Google", async ({ page }) => {
    await page.goto("/connexion");
    await expect(page.getByText("ou utilisez votre compte Google")).toBeVisible();
    await expect(page.locator(".ds-sign-in__intro")).toHaveText(introWithGoogle);
    await expect(page.getByRole("button", { name: continueWithGoogle })).toBeVisible();

    await page.goto("/connexion?error=access_denied");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(failedWithGoogle);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Google");
  });

  test.describe("with Google sign-in not configured", () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });
    let server: Awaited<ReturnType<typeof startServer>>;
    test.beforeAll(async () => {
      server = await startServer(170, { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }, "start");
    });
    test.afterAll(() => server?.stop());

    // Visitors who are not signed in always get French (a signed-in Candidate is sent on to their
    // account), so the English text is covered by apps/web/src/auth/sign-in-copy.test.ts.
    test("the text does not mention Google", async ({ page }) => {
      await page.goto(`${server.origin}/connexion`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.signIn.title);
      await expect(page.locator(".ds-sign-in__intro")).toHaveText(fr.signIn.introWithoutProviders);
      await expect(page.getByRole("button", { name: continueWithGoogle })).toHaveCount(0);
      expect(await page.locator("main").innerText()).not.toMatch(/google/i);
    });

    test("the failed-sign-in notice does not mention Google either", async ({ page }) => {
      await page.goto(`${server.origin}/connexion?error=access_denied`);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(fr.signIn.failedWithoutProviders);
      expect(await page.locator("main").innerText()).not.toMatch(/google/i);
    });
  });
});
