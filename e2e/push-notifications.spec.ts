import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { registerDevice, sendPush } from "./support/push";
import { accountButtonName } from "./support/account-menu";
import { LEGACY_PUSH_EVENTS } from "../apps/web/src/push-notifications/catalog";

// Issue #698: the Jobbbox app's Push notifications. The app registers its device (a token, a platform, a language) while
// signed in; Mon compte's Rappels has one switch per event beside the Appointment Reminder by email, which stays the
// default; the worker sends through APNs and FCM (faked here: e2e/support/push-send.ts), keeps each failure with its
// Failure Reason and removes a device whose token the provider no longer knows; a notification's text never names a
// company, a job or a person; a super-admin sends a test from the Back Office's Outils; the Data export holds the
// devices, never their token.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const SUPER_ADMIN = "push-office@e2e.jobbbox.test";
// The events a Candidate or a Human Coach can be told of while « Espace coach v2 » is off (ADR-0107), the suite's state:
// the Human Coach epic's own are sent only with it on (apps/web/src/push-notifications/catalog.ts, its unit tests).
const EVENTS = Object.keys(fr.pushNotifications.events).filter((event) => (LEGACY_PUSH_EVENTS as readonly string[]).includes(event));
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const register = registerDevice;
const send = sendPush;

async function exportedData(page: Page) {
  await page.goto("/compte/donnees");
  const section = page.getByRole("region", { name: fr.accountData.title });
  const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
  const text = readFileSync((await file.path())!, "utf8");
  return { text, data: JSON.parse(text) };
}

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("Push notifications", () => {
  test("Rappels has one switch per event beside the Appointment Reminder by email, which stays on; each choice is kept", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("push-switches"));
    await page.goto("/compte/rappels");

    const email = page.getByRole("region", { name: fr.appointmentReminder.settings.title });
    await expect(email.getByRole("checkbox", { name: fr.appointmentReminder.settings.label })).toBeChecked();

    const push = page.getByRole("region", { name: fr.pushNotifications.settings.title });
    const candidateEvents = ["job_search_results", "job_digest", "appointment_reminder", "coach_review", "coaching_session_changed", "follow_up_due"];
    for (const event of candidateEvents) await expect(push.getByRole("switch", { name: fr.pushNotifications.events[event] })).toBeChecked();
    // A Candidate sees none of a Human Coach's events.
    await expect(push.getByRole("switch", { name: fr.pushNotifications.events.coaching_session_paid })).toHaveCount(0);

    await push.getByRole("switch", { name: fr.pushNotifications.events.job_digest }).click();
    await expect(push.getByRole("status")).toHaveText(fr.pushNotifications.settings.saved);
    await page.reload();
    const again = page.getByRole("region", { name: fr.pushNotifications.settings.title });
    await expect(again.getByRole("switch", { name: fr.pushNotifications.events.job_digest })).not.toBeChecked();
    await expect(again.getByRole("switch", { name: fr.pushNotifications.events.job_search_results })).toBeChecked();
    // The email reminder is untouched.
    await expect(page.getByRole("region", { name: fr.appointmentReminder.settings.title }).getByRole("checkbox", { name: fr.appointmentReminder.settings.label })).toBeChecked();
  });

  test("a device is registered by the signed-in app only, and an event switched off sends nothing to it", async ({ page, request }) => {
    const token = `tok-${unique()}`;
    const device = { platform: "android", token, language: "fr" };
    expect((await request.post("/api/account/push-devices", { headers: { origin }, data: device })).status()).toBe(401);

    const email = newAddress("push-register");
    await signInWithMagicLink(page, email);
    expect((await register(page, { platform: "windows", token, language: "fr" })).status()).toBe(400);
    expect((await register(page, { platform: "ios", token: "", language: "fr" })).status()).toBe(400);
    expect((await page.request.post("/api/account/push-devices", { headers: { origin: "https://evil.example" }, data: device })).status()).toBe(403);
    expect((await register(page, device)).status()).toBe(204);

    expect(send(email, "job_digest").messages).toHaveLength(1);
    expect((await page.request.put("/api/account/push-notifications", { headers: { origin }, data: { event: "job_digest", enabled: false } })).status()).toBe(200);
    expect(send(email, "job_digest").messages).toHaveLength(0);
    expect(send(email, "follow_up_due").messages).toHaveLength(1);
  });

  test("a notification's text is the event's fixed one, in the device's language, and never names a company, a job or a person", async ({ page }) => {
    const email = newAddress("push-texts");
    await signInWithMagicLink(page, email);
    expect((await register(page, { platform: "android", token: `tok-fr-${unique()}`, language: "fr" })).status()).toBe(204);
    expect((await register(page, { platform: "ios", token: `tok-en-${unique()}`, language: "en" })).status()).toBe(204);
    const names = ["Acme Industrie", "DAF H/F", "Marie Dupont", "Dupont"];

    for (const event of EVENTS) {
      const sent = send(email, event);
      expect(sent.messages, event).toHaveLength(2);
      const [french, english] = sent.messages;
      expect(french, event).toMatchObject({ title: fr.pushNotifications.messages[event].title, body: fr.pushNotifications.messages[event].body });
      expect(english, event).toMatchObject({ title: en.pushNotifications.messages[event].title, body: en.pushNotifications.messages[event].body });
      for (const message of sent.messages) for (const name of names) expect(`${message.title} ${message.body}`, event).not.toContain(name);
      // The app opens the object itself: the deep link carries its id, not a name.
      expect(french.path, event).toMatch(/^\//);
    }
    expect(send(email, "job_search_results").messages[0].title).toBe("Nouveaux résultats pour une recherche");
    expect(send(email, "job_search_results").messages[0].path).toContain("js_1");
  });

  test("the worker keeps a failure with its Failure Reason and removes a device whose token the provider no longer knows", async ({ page, browser }) => {
    const admin = await personPage(browser, SUPER_ADMIN);
    const email = newAddress("push-invalid");
    await signInWithMagicLink(page, email);
    const good = `tok-good-${unique()}`;
    expect((await register(page, { platform: "ios", token: good, language: "fr" })).status()).toBe(204);
    expect((await register(page, { platform: "ios", token: `tok-invalid-${unique()}`, language: "fr" })).status()).toBe(204);

    const sent = send(email, "test");
    expect(sent).toMatchObject({ before: 2, after: 1 });
    expect(sent.messages).toHaveLength(1);
    // The technical message stays in the worker's log, without the token.
    expect(sent.log.join("\n")).not.toMatch(/tok-invalid-/);

    const exported = await exportedData(page);
    expect(exported.data.pushNotifications.devices).toHaveLength(1);

    // The failure shows on APNs' page in Outils: its event and Failure Reason, never a token.
    await admin.goto("/admin/outils/apns");
    const failures = admin.getByRole("table", { name: /APNs|Apple/ });
    await expect(failures.getByRole("row").filter({ hasText: fr.failureReasons.device_token_invalid }).first()).toBeVisible();
    await expect(admin.locator("main")).not.toContainText("tok-invalid-");
    await admin.context().close();
  });

  test("without the provider's key entered, the devices fail with key_missing and are kept", async ({ page }) => {
    const email = newAddress("push-nokey");
    await signInWithMagicLink(page, email);
    expect((await register(page, { platform: "android", token: `tok-${unique()}`, language: "fr" })).status()).toBe(204);
    const sent = send(email, "follow_up_due", "no-keys");
    expect(sent).toMatchObject({ before: 1, after: 1, messages: [] });
    expect(sent.log.join("\n")).toContain("key_missing");
  });

  test("the app forgets its device, signing out forgets it, and deleting the account removes the rest", async ({ page, browser }) => {
    const email = newAddress("push-forget");
    await signInWithMagicLink(page, email);
    const first = `tok-a-${unique()}`;
    const second = `tok-b-${unique()}`;
    await register(page, { platform: "ios", token: first, language: "fr" });
    await register(page, { platform: "android", token: second, language: "en" });
    expect(send(email, "test").before).toBe(2);

    expect((await page.request.delete("/api/account/push-devices", { headers: { origin }, data: { token: first } })).status()).toBe(204);
    expect(send(email, "test").before).toBe(1);

    // A second session's device goes when that session signs out.
    const other = await personPage(browser, email);
    await register(other, { platform: "ios", token: `tok-c-${unique()}`, language: "fr" });
    expect(send(email, "test").before).toBe(2);
    await other.getByRole("button", { name: accountButtonName(fr.nav.account) }).click();
    await other.getByRole("menuitem", { name: fr.account.signOut }).click();
    await expect(other.getByRole("banner").getByRole("link", { name: fr.nav.signIn })).toBeVisible();
    expect(send(email, "test").before).toBe(1);
    await other.context().close();

    const deleted = await page.request.delete("/api/account", { data: { email }, headers: { origin } });
    expect(deleted.status(), await deleted.text()).toBe(204);
    const gone = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/push-send.ts", email, "test"], { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, encoding: "utf8" });
    expect(gone.status).not.toBe(0);
    expect(gone.stderr).toContain("no account");
  });

  test("the Data export holds the devices (platform, language, dates) and the switches, never the token", async ({ page }) => {
    const email = newAddress("push-export");
    await signInWithMagicLink(page, email);
    const token = `tok-secret-${unique()}`;
    await register(page, { platform: "android", token, language: "en" });
    await page.request.put("/api/account/push-notifications", { headers: { origin }, data: { event: "coach_review", enabled: false } });

    const { text, data } = await exportedData(page);
    expect(data.pushNotifications.devices).toEqual([expect.objectContaining({ platform: "android", language: "en", registeredAt: expect.any(String), lastSeenAt: expect.any(String) })]);
    expect(data.pushNotifications.switches).toEqual([expect.objectContaining({ event: "coach_review", enabled: false })]);
    expect(text).not.toContain(token);
  });

  test("a super-admin sends a test from the Tool's page in Outils to their own devices; Support cannot", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/outils/fcm");
    const send = page.getByRole("button", { name: fr.admin.tools.push.testSend });
    await expect(send).toBeDisabled();
    await expect(page.getByText(fr.admin.tools.push.testDevices_zero.replace("{{platform}}", "Android"))).toBeVisible();

    expect((await register(page, { platform: "android", token: `tok-admin-${unique()}`, language: "fr" })).status()).toBe(204);
    await page.goto("/admin/outils/fcm");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("status").filter({ hasText: fr.admin.tools.push.testQueued })).toBeVisible();

    // Another Tool's page has no test.
    await page.goto("/admin/outils/stripe");
    await expect(page.getByRole("button", { name: fr.admin.tools.push.testSend })).toHaveCount(0);

    // Support reads the page but is told only a super-admin sends it.
    const supportEmail = newAddress("push-support");
    const support = await personPage(browser, supportEmail);
    await page.goto("/admin/administrateurs");
    await page.getByLabel(fr.admin.administrators.grantEmail).fill(supportEmail);
    await page.getByRole("checkbox", { name: fr.admin.roles.support }).check();
    await page.getByRole("button", { name: fr.admin.administrators.grant }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await support.goto("/admin/outils/fcm");
    await expect(support.getByText(fr.admin.tools.push.testSuperAdminOnly)).toBeVisible();
    await expect(support.getByRole("button", { name: fr.admin.tools.push.testSend })).toHaveCount(0);
    await support.context().close();
  });
});
