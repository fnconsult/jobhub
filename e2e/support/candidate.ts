import { expect, type Page } from "@playwright/test";
import { linkIn, waitForEmail, emailsTo, type Email } from "./mailbox";

/**
 * Signs `email` in (or up) through the sign-in page and the emailed link, the
 * way a person does. Returns the email they received. Leaves `page` on the
 * account page.
 */
/**
 * Sign-in endpoints are rate limited per client address (a few requests per
 * 10 s). The suite signs many people in from one machine, so each sign-in
 * comes from its own address, as it would for distinct people.
 */
export async function fromNewAddress(page: Page) {
  const byte = () => 1 + Math.floor(Math.random() * 254);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.${byte()}.${byte()}.${byte()}` });
}

export async function signInWithMagicLink(page: Page, email: string, submitLabel = /Recevoir mon lien|Send me a sign-in link/): Promise<Email> {
  const already = emailsTo(email).length;
  await fromNewAddress(page);
  await page.goto("/connexion");
  await page.getByLabel(/Votre adresse e-mail|Your email address/).fill(email);
  await page.getByRole("button", { name: submitLabel }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const message = await waitForEmail(email, already);
  await page.goto(linkIn(message));
  await expect(page).toHaveURL(/\/compte$/);
  return message;
}

/**
 * Plays Google for the browser side of "Continue with Google": checks the
 * authorization request, then sends the person back to the app as if they had
 * approved, with their Google identity (decoded by e2e/support/fake-google.mjs).
 */
export async function approveAtGoogle(page: Page, identity: Record<string, unknown>, origin: string) {
  await fromNewAddress(page);
  await page.route("https://accounts.google.com/**", async (route) => {
    const authorize = new URL(route.request().url());
    expect(authorize.searchParams.get("client_id")).toBe("e2e-client.apps.googleusercontent.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
    const code = Buffer.from(JSON.stringify(identity)).toString("base64url");
    const callback = new URL("/api/auth/callback/google", origin);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
}
