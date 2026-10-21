import type { APIResponse, Page } from "@playwright/test";

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
