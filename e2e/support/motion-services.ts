import { spawnSync } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";
import { migrateCoachPages } from "../../apps/web/src/coach-pages";
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
  let done!: (failure: Error | null) => void;
  let successUrl = "";
  const handled = new Promise<Error | null>((resolve) => (done = resolve));
  await page.route(
    (url) => /\/checkout$/.test(url.pathname),
    async (route) => {
      try {
        const answer = await route.fetch({ maxRedirects: 0, timeout: 60_000 });
        const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
        const checkout = calls.filter((call) => call.path === "/v1/checkout/sessions").at(-1)?.params;
        if (answer.status() !== 303 || !checkout) {
          await route.fulfill({ response: answer });
          return done(new Error(`the checkout answered ${answer.status()}: ${(await answer.text()).slice(0, 200)}`));
        }
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
        // An event id of its own: the app takes an event it already had for Stripe delivering it twice.
        const { payload, signature } = signedEvent({ ...event, id: `evt_motions_${Date.now()}_${Math.random().toString(36).slice(2)}` });
        const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" }, timeout: 60_000 });
        if (delivered.status() !== 200) throw new Error(`the webhook answered ${delivered.status()}`);
        // Back where Stripe sends the Candidate. A redirect answered for a form's navigation is not always followed: the page
        // goes there itself, and the capture makes sure it did (below).
        successUrl = checkout.success_url!;
        await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(successUrl)})</script>` });
        done(null);
      } catch (error) {
        await route.abort().catch(() => {});
        done(error instanceof Error ? error : new Error(String(error)));
      }
    },
    { times: 1 },
  );
  // The submit's answer waits on the server, then on the webhook: on a loaded machine longer than an action's 10 s.
  await submit.click({ noWaitAfter: true, timeout: 30_000 });
  const failure = await Promise.race([handled, page.waitForTimeout(60_000).then(() => new Error("« Passer au paiement » sent no checkout in 60 s"))]);
  if (failure) throw failure;
  await page.waitForURL(/[?&]session=paid/, { timeout: 15_000 }).catch(() => page.goto(successUrl, { timeout: 30_000 }));
}

/** The services of a capture of `script`. */
export function captureServices(script: MotionScript): CaptureServices {
  const sentBefore: Record<string, number> = {};
  const services: CaptureServices = {
    files: { "cv-claire-demo.pdf": { name: "CV Claire Démo.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(DEMO_CV_LINES)) } },
    email: async (address, subject) => {
      // Only an email sent since the address was typed: a database kept from an earlier run holds its old ones.
      const before = sentBefore[address] ?? 0;
      await expect.poll(() => emailsTo(address).length, { message: `an email to ${address}`, timeout: 30_000 }).toBeGreaterThan(before);
      const email = emailsTo(address).at(-1)!;
      if (email.subject !== subject) throw new Error(`the last email to ${address} is « ${email.subject} », not « ${subject} »`);
      // The sign-in email as it was sent (its language is the subject's); any other as its text.
      if (/\/api\/auth\/magic-link\/verify/.test(email.text)) return signInEmail(linkIn(email), script.locale).html;
      return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(subject)}</title><pre style="font:16px/1.5 system-ui;margin:40px;white-space:pre-wrap">${escapeHtml(email.text)}</pre>`;
    },
    typed: (address) => {
      sentBefore[address] = emailsTo(address).length;
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
    await admin.getByRole("button", { name: "Ajouter le coach" }).click();
    await expect(admin.getByRole("status")).toHaveText(`Coach ${DEMO_COACH.name} ajouté.`);
  }
  // The Back Office's form no longer takes a biography (#867, not gated: the Back Office is the same whatever « Espace
  // coach v2 »): the demo coach's is written in this run's throwaway database, as an already approved legacy biography,
  // without inventing a legal approval.
  const database = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    await database.query("UPDATE human_coach SET public_ready=true,bio=$2 WHERE email=$1", [DEMO_COACH.email, DEMO_COACH.bio]);
    await migrateCoachPages(database);
  } finally {
    await database.end();
  }
  await context.close();
  coachAdded = true;
}
