import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #566: the Nouveautés email is a Candidate's choice in Mon compte's Préférences, never ticked by default, dated
// when ticked; its email's unsubscribe link works with no sign-in. The Release Note it links to has its own page.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

test.afterAll(async () => {
  await database.end();
});

/** The unsubscribe token of the Candidate signed in with `email`, as their Nouveautés email's link carries it. */
async function unsubscribeToken(email: string): Promise<string | null> {
  const { rows } = await database.query<{ token: string }>(
    `SELECT s.unsubscribe_token AS token FROM nouveautes_email_subscription s JOIN candidate c ON c.id = s.candidate_id WHERE c.email = $1`,
    [email],
  );
  return rows[0]?.token ?? null;
}

test.describe("Nouveautés email", () => {
  test("the box is unticked; ticking it says since when; the email's link unsubscribes without signing in", async ({ page, browser }) => {
    const email = newAddress("nouveautes-email");
    await signInWithMagicLink(page, email);
    await page.goto("/compte/preferences");

    const checkbox = page.getByRole("checkbox", { name: fr.nouveautesEmail.settings.label });
    await expect(checkbox).not.toBeChecked();
    expect(await unsubscribeToken(email)).toBeNull();

    await checkbox.check();
    await expect(page.getByRole("status").filter({ hasText: fr.nouveautesEmail.settings.on })).toBeVisible();
    await expect(checkbox).toHaveAccessibleDescription(/Inscrit depuis le \d{1,2} \S+ \d{4}\./);
    await page.reload();
    await expect(checkbox).toBeChecked();
    const token = await unsubscribeToken(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The email's link, opened where no one is signed in: it asks first, then says it is done.
    const signedOut = await browser.newContext({ locale: "fr-FR" });
    const visitor = await signedOut.newPage();
    await visitor.goto(`${origin}/desabonnement/nouveautes?token=${token}&lang=fr`);
    await expect(visitor.getByRole("heading", { level: 1, name: fr.nouveautesEmail.unsubscribePage.title })).toBeVisible();
    await visitor.getByRole("button", { name: fr.nouveautesEmail.unsubscribePage.action }).click();
    await expect(visitor.getByRole("status")).toHaveText(fr.nouveautesEmail.unsubscribePage.done);
    // The one-click POST (RFC 8058) with the same token finds nothing left to unsubscribe.
    const again = await visitor.request.post(`${origin}/api/nouveautes-email/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
    expect(again.status()).toBe(404);
    await signedOut.close();

    await page.reload();
    await expect(checkbox).not.toBeChecked();
    expect(await unsubscribeToken(email)).toBeNull();
  });

  test("a Version's Release Note has its own page on Nouveautés, which the email links to; an unknown Version is not found", async ({ page }) => {
    await page.goto("/nouveautes/0.1.0?lang=fr");
    await expect(page.getByRole("heading", { level: 1, name: "Version 0.1.0" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jobbbox, la première version" })).toBeVisible();
    await expect(page.getByRole("link", { name: fr.nouveautes.allVersions })).toHaveAttribute("href", /\/nouveautes(\?|$)/);

    const missing = await page.goto("/nouveautes/9.9.9");
    expect(missing?.status()).toBe(404);
  });
});
