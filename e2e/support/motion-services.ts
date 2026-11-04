import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import type { MotionScript } from "@jobhub/help";
import { checkoutSessionEvent, FAKE_STRIPE_COACHING_SESSION_PRICES, signedEvent } from "../../apps/web/src/billing/fake-stripe";
import { pdfCv } from "../../apps/web/src/cv/test-support";
import type { CaptureServices } from "../../packages/motions/src/capture";
import { DEMO_ADMINISTRATOR, DEMO_COACH, DEMO_CV_LINES, DEMO_JOB_OFFER, DEMO_JOB_OFFER_HTML } from "../../packages/motions/src/demo-seed";
import { signInWithMagicLink } from "./candidate";
import { buildE2eExtension, e2eExtensionDir, unpackedExtensionId } from "./extension";
import { emailsTo, linkIn } from "./mailbox";

// Issue #570: what the motions' captures use beyond the page they film, on the e2e server of the run: the demo CV, the
// sign-in email as a mail client shows it, a Coaching Session paid in Stripe's test mode (the fake Stripe API of the
// run, whose webhook the app trusts), and the extension built against this server for a Guest's videos.
const origin = process.env.E2E_WEB_ORIGIN!;
const stripeUrl = process.env.E2E_STRIPE_URL!;

/** The sign-in email with `link`, in `locale` (e2e/support/motion-email.ts). */
function signInEmail(link: string, locale: string): { subject: string; html: string } {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/motion-email.ts", link, locale], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout) as { subject: string; html: string };
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Pays the checkout `submit` posts to: Stripe's test mode answers « paid », its signed webhook reaches the app, and the page lands where Stripe sends the Candidate back. */
async function payInTestMode(page: Page, submit: Locator) {
  let paid: Promise<void> | undefined;
  await page.route(
    (url) => /\/checkout$/.test(url.pathname),
    async (route) => {
      const answer = await route.fetch({ maxRedirects: 0 });
      const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
      const checkout = calls.filter((call) => call.path === "/v1/checkout/sessions").at(-1)?.params;
      if (answer.status() !== 303 || !checkout) return route.fulfill({ response: answer });
      const price = checkout["line_items[0][price]"];
      const amount = price === FAKE_STRIPE_COACHING_SESSION_PRICES.discounted ? 7200 : 9000;
      const event = checkoutSessionEvent("checkout.session.completed", {
        id: `cs_motions_${Date.now()}`,
        candidateId: checkout["metadata[candidate_id]"]!,
        coachId: checkout["metadata[coach_id]"],
        amount,
        currency: "eur",
        paymentStatus: "paid",
      });
      const { payload, signature } = signedEvent(event);
      paid = page.request
        .post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } })
        .then((response) => expect(response.status()).toBe(200));
      await paid;
      await route.fulfill({ status: 303, headers: { location: checkout.success_url! } });
    },
    { times: 1 },
  );
  await submit.click();
  await page.waitForURL(/[?&]session=paid/, { timeout: 30_000 });
  await paid;
}

/** The services of a capture of `script`. */
export function captureServices(script: MotionScript): CaptureServices {
  const services: CaptureServices = {
    files: { "cv-claire-demo.pdf": { name: "CV Claire Démo.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(DEMO_CV_LINES)) } },
    email: async (address, subject) => {
      await expect.poll(() => emailsTo(address).length, { message: `an email to ${address}`, timeout: 30_000 }).toBeGreaterThan(0);
      const email = emailsTo(address).at(-1)!;
      if (email.subject !== subject) throw new Error(`the last email to ${address} is « ${email.subject} », not « ${subject} »`);
      // The sign-in email as it was sent (its language is the subject's); any other as its text.
      if (/\/api\/auth\/magic-link\/verify/.test(email.text)) return signInEmail(linkIn(email), script.locale).html;
      return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(subject)}</title><pre style="font:16px/1.5 system-ui;margin:40px;white-space:pre-wrap">${escapeHtml(email.text)}</pre>`;
    },
    pay: payInTestMode,
  };
  if (script.viewer === "guest") {
    buildE2eExtension();
    services.extension = { dir: e2eExtensionDir, id: unpackedExtensionId(e2eExtensionDir), jobOffer: { url: DEMO_JOB_OFFER.url, html: DEMO_JOB_OFFER_HTML } };
  }
  return services;
}

let coachAdded = false;
/** The demo Human Coach, added once by the run's Administrator in the Back Office, for a video that films « Mes coachs humains ». */
export async function addDemoCoach(browser: Browser): Promise<void> {
  if (coachAdded) return;
  const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
  const admin = await context.newPage();
  await signInWithMagicLink(admin, DEMO_ADMINISTRATOR);
  await admin.goto("/admin/coachs");
  if ((await admin.getByText(DEMO_COACH.name, { exact: true }).count()) === 0) {
    await admin.getByLabel("Nom", { exact: true }).fill(DEMO_COACH.name);
    await admin.getByLabel("Adresse e-mail de connexion").fill(DEMO_COACH.email);
    await admin.getByLabel("Lien de réservation Cal.com").fill(DEMO_COACH.bookingUrl);
    await admin.getByLabel("Présentation (facultatif)").fill(DEMO_COACH.bio);
    await admin.getByRole("button", { name: "Ajouter le coach" }).click();
    await expect(admin.getByRole("status")).toHaveText(`Coach ${DEMO_COACH.name} ajouté.`);
  }
  await context.close();
  coachAdded = true;
}
