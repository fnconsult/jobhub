import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newAddress } from "./support/mailbox";
import { approveAtIssuer, FAKE_OIDC_ISSUER, refuseAtIssuer, signInByEmail, startSignInServer, SSO_SUPER_ADMIN, type SignInServer } from "./support/sign-in-server";

// Issue #209: Sign-in Providers configured from the Back Office. A super-admin adds a
// generic OIDC provider in the Connexion section, tests it by signing in, then enables it:
// it is in use at once, with no deploy and nobody signed out. A provider allowed for
// Administrators but not shown to Candidates is only on the Back Office sign-in; one not
// trusted for linking never takes over an account by email (magic link first, then linking
// from Mon compte); Require SSO for Administrators sends a magic-link Administrator back to
// sign in with a provider, but not an ADMIN_EMAILS super-admin, and not to their Candidate
// pages. A client secret is never sent back. Apple's client secret is signed from the .p8
// key on save, with its next signature date shown. On a server of its own (see the support file).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const sp = fr.admin.signInProviders;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const SSO = { id: "e2e-sso", name: "Jobbbox SSO", clientId: "jobbbox-e2e-web", secret: `e2e-oidc-secret-${Date.now()}` };
const continueWithSso = tr(fr.signIn.continueWith, { provider: SSO.name });

test.describe("Sign-in Providers (Paramètres' Connexion tab)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let server: SignInServer;
  let superAdmin: Page;

  test.beforeAll(async ({ browser }) => {
    server = await startSignInServer(209);
    superAdmin = await personPage(browser, SSO_SUPER_ADMIN);
  });
  test.afterAll(async () => {
    await superAdmin?.context().close();
    await server?.stop();
  });

  async function personPage(browser: Browser, email?: string): Promise<Page> {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    if (email) await signInByEmail(page, server, email);
    return page;
  }

  const article = (page: Page, name: string) => page.locator("article").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${name}`) }) });

  /** Opens provider `name`'s edit form, sets its switches to `switches`, and saves it. */
  async function edit(name: string, switches: Partial<Record<"shownToCandidatesLabel" | "allowedForAdministratorsLabel" | "trustedLabel" | "enabledLabel", boolean>>) {
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    const form = article(superAdmin, name).locator("details");
    await form.locator("summary").click();
    for (const [label, on] of Object.entries(switches)) await form.getByRole("checkbox", { name: sp[label], exact: true }).setChecked(on);
    await form.getByRole("button", { name: sp.save }).click();
  }

  test("env's Google client is a provider after the deployment, and Google sign-in still works", async ({ browser }) => {
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    await expect(superAdmin.getByRole("heading", { level: 1 })).toHaveText(fr.admin.platformSettings.title);
    const google = article(superAdmin, "Google");
    await expect(google).toContainText(sp.enabled);
    await expect(google).toContainText(`${server.origin}/api/auth/callback/google`);
    await expect(google).toContainText(`${sp.fields.clientSecret} : ${sp.sources.env}`);

    const page = await personPage(browser);
    const email = newAddress("google.after.deploy");
    await page.route("https://accounts.google.com/**", async (route) => {
      const authorize = new URL(route.request().url());
      const callback = new URL(authorize.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", Buffer.from(JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name: "Après Déploiement" })).toString("base64url"));
      callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
      await route.fulfill({ status: 302, headers: { location: callback.toString() } });
    });
    await page.goto(`${server.origin}/connexion`);
    await page.getByRole("button", { name: tr(fr.signIn.continueWith, { provider: "Google" }) }).click();
    await expect(page).toHaveURL(`${server.origin}/compte`);
    await page.context().close();
  });

  test("a super-admin adds an OIDC provider, tests it, then enables it for Administrators only; its secret is never sent back", async ({ browser }) => {
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    await superAdmin.locator("summary", { hasText: tr(sp.add, { type: sp.types.oidc }) }).click();
    const form = superAdmin.locator("details[open] form");
    await form.getByLabel(sp.id, { exact: true }).fill(SSO.id);
    await form.getByLabel(sp.displayName).fill(SSO.name);
    await form.getByLabel(sp.clientId).fill(SSO.clientId);
    await form.getByLabel(sp.discoveryUrl).fill(`${FAKE_OIDC_ISSUER}/.well-known/openid-configuration`);
    await form.getByLabel(sp.fields.clientSecret).fill(SSO.secret);
    await form.getByRole("checkbox", { name: sp.shownToCandidatesLabel }).uncheck();
    // Enabling before a test sign-in is refused, and nothing is saved.
    await form.getByRole("checkbox", { name: sp.enabledLabel, exact: true }).check();
    await form.getByRole("button", { name: sp.save }).click();
    await expect(superAdmin.getByRole("main").getByRole("alert")).toHaveText(sp.errors.not_tested);
    await expect(article(superAdmin, SSO.name)).toHaveCount(0);

    await superAdmin.locator("details[open] form").getByLabel(sp.id, { exact: true }).fill(SSO.id);
    const again = superAdmin.locator("details[open] form");
    await again.getByLabel(sp.displayName).fill(SSO.name);
    await again.getByLabel(sp.clientId).fill(SSO.clientId);
    await again.getByLabel(sp.discoveryUrl).fill(`${FAKE_OIDC_ISSUER}/.well-known/openid-configuration`);
    await again.getByLabel(sp.fields.clientSecret).fill(SSO.secret);
    await again.getByRole("checkbox", { name: sp.shownToCandidatesLabel }).uncheck();
    await again.getByRole("checkbox", { name: sp.enabledLabel, exact: true }).uncheck();
    await again.getByRole("button", { name: sp.save }).click();
    await expect(superAdmin.getByRole("status")).toHaveText(tr(sp.saved, { name: SSO.name }));
    const provider = article(superAdmin, SSO.name);
    await expect(provider).toContainText(sp.disabled);
    await expect(provider).toContainText(sp.notTested);
    const callbackUrl = (await provider.locator("dd code.wrap-anywhere").textContent())!;
    expect(callbackUrl).toBe(`${server.origin}/api/auth/callback/${SSO.id}`);

    // A test sign-in the issuer refuses: Connexion says so, and the Journal keeps it as a failed test,
    // with Better Auth's code as its technical detail (#263). Shown again, it is not recorded twice.
    await refuseAtIssuer(superAdmin, "access_denied");
    await provider.getByRole("button", { name: tr(sp.test, { name: SSO.name }) }).click();
    await expect(superAdmin).toHaveURL(new RegExp(`/admin/parametres\\?tab=connexion&testFailed=${SSO.id}&error=access_denied`));
    await expect(superAdmin.getByRole("main").getByRole("alert")).toHaveText(tr(sp.testFailed, { name: SSO.name }));
    await superAdmin.reload();
    await superAdmin.goto(`${server.origin}/admin/journal?section=sign_in_providers&outcome=failed`);
    const failedTests = superAdmin.getByRole("row").filter({ hasText: tr(fr.admin.journal.failed, { tried: fr.admin.journal.actions.tested, reason: fr.failureReasons.test_failed }) });
    await expect(failedTests).toHaveCount(1);
    await expect(failedTests).toContainText(SSO.id);
    await expect(failedTests).toContainText(fr.admin.journal.outcomes.failed);
    await failedTests.getByText(fr.admin.journal.technicalDetail).click();
    await expect(failedTests.locator("code")).toHaveText("access_denied");
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);

    // The test sign-in: the super-admin signs in at the issuer, comes back, nothing is created.
    let redirectUri = "";
    await approveAtIssuer(superAdmin, { sub: "sso-office", email: SSO_SUPER_ADMIN, email_verified: true, name: "SSO Office" }, SSO.clientId, (uri) => (redirectUri = uri));
    await provider.getByRole("button", { name: tr(sp.test, { name: SSO.name }) }).click();
    await expect(superAdmin).toHaveURL(`${server.origin}/admin/parametres?tab=connexion&tested=${SSO.id}`);
    expect(redirectUri, "the callback URL shown is the one the app sends").toBe(callbackUrl);
    await expect(superAdmin.getByRole("status")).toHaveText(tr(sp.testPassed, { name: SSO.name }));
    await expect(article(superAdmin, SSO.name)).not.toContainText(sp.notTested);

    await edit(SSO.name, { enabledLabel: true });
    await expect(superAdmin.getByRole("status")).toHaveText(tr(sp.saved, { name: SSO.name }));
    await expect(article(superAdmin, SSO.name).getByRole("heading")).toContainText(sp.enabled);

    // In use at once: not on the Candidate sign-in page, on the Back Office's.
    const visitor = await personPage(browser);
    await visitor.goto(`${server.origin}/connexion`);
    await expect(visitor.getByRole("button", { name: tr(fr.signIn.continueWith, { provider: "Google" }) })).toBeVisible();
    await expect(visitor.getByRole("button", { name: continueWithSso })).toHaveCount(0);
    await visitor.goto(`${server.origin}/connexion/back-office`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(fr.backOfficeSignIn.title);
    await expect(visitor.getByRole("button", { name: continueWithSso })).toBeVisible();

    // A Candidate cannot use it, even by the Back Office sign-in page.
    await approveAtIssuer(visitor, { sub: "sso-candidate", email: newAddress("sso.candidate"), email_verified: true, name: "Candidat" }, SSO.clientId);
    await visitor.getByRole("button", { name: continueWithSso }).click();
    await expect(visitor).toHaveURL(/\/connexion\/back-office\?error=provider_not_allowed(&|$)/);
    await expect(visitor.getByRole("main").getByRole("alert")).toHaveText(fr.signIn.providerNotAllowed);
    await visitor.context().close();

    // Not trusted for linking: the super-admin links it once from Mon compte, where it is offered
    // to Administrators though not to Candidates; then, elsewhere, signs in through it to the Back Office.
    await approveAtIssuer(superAdmin, { sub: "sso-office", email: SSO_SUPER_ADMIN, email_verified: true, name: "SSO Office" }, SSO.clientId);
    await superAdmin.goto(`${server.origin}/compte/connexion`);
    await superAdmin.getByRole("button", { name: tr(fr.signInMethods.link, { provider: SSO.name }) }).click();
    await expect(superAdmin).toHaveURL(`${server.origin}/compte/connexion`);
    await expect(superAdmin.getByText(tr(fr.signInMethods.linked, { provider: SSO.name }))).toBeVisible();
    const elsewhere = await personPage(browser);
    await approveAtIssuer(elsewhere, { sub: "sso-office", email: SSO_SUPER_ADMIN, email_verified: true, name: "SSO Office" }, SSO.clientId);
    await elsewhere.goto(`${server.origin}/connexion/back-office`);
    await elsewhere.getByRole("button", { name: continueWithSso }).click();
    await expect(elsewhere).toHaveURL(`${server.origin}/admin`);
    await elsewhere.context().close();

    // Never sent back: not in the page, nor the server's log. Recorded in the Journal, without it.
    await superAdmin.goto(`${server.origin}/admin/journal?section=sign_in_providers`);
    await expect(superAdmin.getByRole("row").filter({ hasText: SSO.id }).first()).toContainText(fr.admin.journal.sections.sign_in_providers);
    for (const path of ["/admin/parametres?tab=connexion", "/admin/journal"]) {
      await superAdmin.goto(`${server.origin}${path}`);
      expect(await superAdmin.content(), path).not.toContain(SSO.secret);
    }
    expect(server.output()).not.toContain(SSO.secret);
    expect(server.output()).not.toContain("e2e-client-secret");
  });

  test("shown to Candidates but not trusted for linking: an account with the same email is linked from Mon compte only", async ({ browser }) => {
    await edit(SSO.name, { shownToCandidatesLabel: true });
    await expect(superAdmin.getByRole("status")).toHaveText(tr(sp.saved, { name: SSO.name }));

    const email = newAddress("sso.linked");
    const byEmail = await personPage(browser, email);

    const viaSso = await personPage(browser);
    await approveAtIssuer(viaSso, { sub: `sso-${email}`, email, email_verified: true, name: "Lien Plus Tard" }, SSO.clientId);
    await viaSso.goto(`${server.origin}/connexion`);
    await viaSso.getByRole("button", { name: continueWithSso }).click();
    await expect(viaSso).toHaveURL(/\/connexion\?error=account_not_linked(&|$)/);
    await expect(viaSso.getByRole("main").getByRole("alert")).toHaveText(fr.signIn.accountNotLinked);

    // Signed in by magic link, the Candidate links it from Mon compte.
    await approveAtIssuer(byEmail, { sub: `sso-${email}`, email, email_verified: true, name: "Lien Plus Tard" }, SSO.clientId);
    await byEmail.goto(`${server.origin}/compte/connexion`);
    await byEmail.getByRole("button", { name: tr(fr.signInMethods.link, { provider: SSO.name }) }).click();
    await expect(byEmail).toHaveURL(`${server.origin}/compte/connexion`);
    await expect(byEmail.getByText(tr(fr.signInMethods.linked, { provider: SSO.name }))).toBeVisible();

    // From then on, the provider signs into the same account.
    await viaSso.getByRole("button", { name: continueWithSso }).click();
    await expect(viaSso).toHaveURL(`${server.origin}/compte`);
    const [one, other] = await Promise.all([byEmail, viaSso].map(async (page) => (await page.request.get(`${server.origin}/api/auth/get-session`)).json()));
    expect(other.user.id).toBe(one.user.id);
    await byEmail.context().close();
    await viaSso.context().close();
  });

  test("Require SSO for Administrators: a magic-link Administrator signs in again with a provider; ADMIN_EMAILS and Candidate pages are untouched", async ({ browser }) => {
    const email = newAddress("sso.support");
    const support = await personPage(browser, email);
    await superAdmin.goto(`${server.origin}/admin/administrateurs`);
    await superAdmin.getByLabel(fr.admin.administrators.grantEmail).fill(email);
    await superAdmin.getByRole("checkbox", { name: fr.admin.roles.support }).check();
    await superAdmin.getByRole("button", { name: fr.admin.administrators.grant }).click();
    await expect(superAdmin.getByRole("status")).toBeVisible();
    await support.goto(`${server.origin}/admin`);
    await expect(support.getByRole("heading", { level: 1 })).toHaveText(fr.admin.dashboard.title);

    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    await superAdmin.getByRole("checkbox", { name: sp.ssoLabel }).check();
    await superAdmin.getByRole("button", { name: sp.ssoSave }).click();
    await expect(superAdmin.getByRole("status")).toHaveText(sp.ssoOn);

    // Signed in by magic link: sent to sign in again, with no magic link offered there.
    await support.goto(`${server.origin}/admin`);
    await expect(support).toHaveURL(`${server.origin}/connexion/back-office`);
    await expect(support.getByRole("status")).toHaveText(fr.backOfficeSignIn.ssoRequired);
    await expect(support.getByLabel(fr.signIn.emailLabel)).toHaveCount(0);
    // The Back Office's API routes (the Back Office Assistant's) are closed to them too.
    const assistant = `${server.origin}/api/admin/assistant/conversations`;
    expect((await support.request.get(assistant)).status()).toBe(404);
    // Their Candidate pages stay open.
    await support.goto(`${server.origin}/compte/connexion`);
    await expect(support).toHaveURL(`${server.origin}/compte/connexion`);

    // The ADMIN_EMAILS super-admin, signed in by magic link, is exempt.
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    await expect(superAdmin.getByRole("heading", { level: 1 })).toHaveText(fr.admin.platformSettings.title);

    // Linked once from Mon compte, then signed in with it: the Back Office opens.
    await approveAtIssuer(support, { sub: `sso-${email}`, email, email_verified: true, name: "Support" }, SSO.clientId);
    await support.getByRole("button", { name: tr(fr.signInMethods.link, { provider: SSO.name }) }).click();
    await expect(support.getByText(tr(fr.signInMethods.linked, { provider: SSO.name }))).toBeVisible();
    await support.goto(`${server.origin}/connexion/back-office`);
    await support.getByRole("button", { name: continueWithSso }).click();
    await expect(support).toHaveURL(`${server.origin}/admin`);
    await expect(support.getByRole("heading", { level: 1 })).toHaveText(fr.admin.dashboard.title);
    expect((await support.request.get(assistant)).status()).toBe(200);

    await superAdmin.getByRole("checkbox", { name: sp.ssoLabel }).uncheck();
    await superAdmin.getByRole("button", { name: sp.ssoSave }).click();
    await expect(superAdmin.getByRole("status")).toHaveText(sp.ssoOff);
    await support.context().close();
  });

  test("Apple: the client secret is signed from the .p8 key as soon as it is saved, with its next signature date; the key is never sent back", async () => {
    const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    await superAdmin.goto(`${server.origin}/admin/parametres?tab=connexion`);
    await superAdmin.locator("summary", { hasText: tr(sp.add, { type: sp.types.apple }) }).click();
    const form = superAdmin.locator("details[open] form");
    await form.getByLabel(sp.serviceId).fill("fr.jobbbox.e2e.signin");
    await form.getByLabel(sp.fields.teamId).fill("E2ETEAM001");
    await form.getByLabel(sp.fields.keyId).fill("E2EKEY0001");
    await form.getByLabel(sp.fields.privateKey).fill(privateKey);
    await form.getByRole("button", { name: sp.save }).click();
    await expect(superAdmin.getByRole("status")).toHaveText(tr(sp.saved, { name: "Apple" }));

    const apple = article(superAdmin, "Apple");
    await expect(apple).toContainText(`${server.origin}/api/auth/callback/apple`);
    await expect(apple).toContainText(sp.appleSecret);
    await expect(apple).toContainText(/Prochaine signature : /);
    const body = privateKey.split("\n")[1]!;
    expect(await superAdmin.content()).not.toContain(body);
    expect(server.output()).not.toContain(body);
  });
});
