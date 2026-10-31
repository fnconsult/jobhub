import { readFileSync } from "node:fs";
import type { APIResponse, Page } from "@playwright/test";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

/**
 * Clicks a button whose form the server answers with a redirect to one of Stripe's pages
 * (https://*.stripe.test/…, from the fake Stripe), and returns that answer as the server sent it.
 *
 * The browser never goes to Stripe. page.route cannot stand in for a redirect's target (Playwright
 * calls a route's handler for the first URL only), so a browser following the redirect looks the
 * made-up host up for real; the lookup fails with net::ERR_NAME_NOT_RESOLVED, and a
 * page.waitForURL still waiting then throws it: how soon the lookup fails depends on the machine's
 * DNS. Here the request to `path` is sent by Playwright, without following the redirect, and the
 * browser gets a stand-in page in its place, which this waits for, so the next page.goto is not
 * interrupted.
 */
export async function submitToStripe(page: Page, path: string, button: string): Promise<APIResponse> {
  let answer: APIResponse | undefined;
  const isPath = (url: URL) => url.pathname === path;
  await page.route(isPath, async (route) => {
    answer = await route.fetch({ maxRedirects: 0 });
    await route.fulfill({ status: 200, contentType: "text/plain", body: "Stripe" });
  }, { times: 1 });
  await Promise.all([page.waitForURL(isPath), page.getByRole("button", { name: button }).click()]);
  if (!answer) throw new Error(`submitToStripe: the button "${button}" sent no request to ${path}`);
  return answer;
}

/**
 * Chooses a Plan or a Coaching Session with its button (`choose`), then, on the Order page (#512), ticks the boxes asked
 * (`immediateExecution`; the CGV box whenever the page shows one) and « Passer au paiement », which posts to `path`:
 * returns its answer, as `submitToStripe` does.
 */
export async function orderToStripe(page: Page, path: string, choose: string, boxes: { immediateExecution?: boolean } = {}): Promise<APIResponse> {
  await Promise.all([page.waitForURL(/\/commande\?/), page.getByRole("button", { name: choose }).click()]);
  const cgv = page.getByRole("checkbox", { name: /^J'accepte les CGV/ });
  if ((await cgv.count()) > 0) await cgv.check();
  if (boxes.immediateExecution) await page.getByRole("checkbox", { name: /^Je demande que le service commence immédiatement/ }).check();
  return submitToStripe(page, path, fr.orders.page.submit);
}
