import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { submitToStripe } from "./support/stripe-checkout";

// The specs that send the browser to Stripe Checkout (billing, coupons, human-coaches) click through
// submitToStripe. A browser following the redirect to *.stripe.test looks that made-up host up for
// real, and failed with net::ERR_NAME_NOT_RESOLVED in a spec's page.waitForURL whenever the lookup
// took long enough to still be under way (coupons.spec.ts, #251). Its own small server, no web app:
// a form posted to /checkout is answered as the app answers it, 303 to Stripe's page.
test("a form the server sends to Stripe Checkout is sent as the browser posts it, and Stripe's host is never looked up", async ({ page }) => {
  const received: { cookie?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/checkout") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ cookie: req.headers.cookie, body });
        res.writeHead(303, { location: "https://checkout.stripe.test/c/pay/cs_e2e" }).end();
      });
      return;
    }
    res.setHeader("content-type", "text/html");
    res.setHeader("set-cookie", "session=e2e; Path=/; HttpOnly");
    res.end('<form method="post" action="/checkout"><input type="hidden" name="plan" value="standard"><button>Choisir</button></form>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const stripeRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith(".stripe.test")) stripeRequests.push(request.url());
    });
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);

    const response = await submitToStripe(page, "/checkout", "Choisir");

    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe("https://checkout.stripe.test/c/pay/cs_e2e");
    expect(received).toEqual([{ cookie: "session=e2e", body: "plan=standard" }]);
    expect(stripeRequests).toEqual([]);
    await expect(page.locator("body")).toHaveText("Stripe");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
