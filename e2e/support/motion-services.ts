import { spawnSync } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";
import { migrateCoachPages } from "../../apps/web/src/coach-pages";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import type { MotionScript } from "@jobhub/help";
import { signedEvent } from "../../apps/web/src/billing/fake-stripe";
import { pdfCv } from "../../apps/web/src/cv/test-support";
import type { CaptureServices } from "../../packages/motions/src/capture";
import { DEMO_ADMINISTRATOR, DEMO_COACH, DEMO_CV_LINES, DEMO_JOB_OFFER, DEMO_JOB_OFFER_HTML } from "../../packages/motions/src/demo-seed";
import { signInWithMagicLink } from "./candidate";
import { signInByEmail, type OwnServer } from "./own-server";
import { buildE2eExtension, e2eExtensionDir, unpackedExtensionId } from "./extension";
import { emailsTo, emailsIn, linkIn } from "./mailbox";

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
        const state = await (await fetch(`${stripeUrl}/__connect/state`)).json();
        const session = state.sessions.findLast((item: { value: {metadata?: {jobhub_context?: string}} }) => item.value.metadata?.jobhub_context === checkout["metadata[jobhub_context]"])?.value;
        if (!session) throw new Error("Motion Checkout has no frozen payment context");
        await fetch(`${stripeUrl}/__connect/pay`, {method:"POST",body:new URLSearchParams({session:session.id})});
        const paid = (await (await fetch(`${stripeUrl}/__connect/state`)).json()).sessions.find((item: {value:{id:string}})=>item.value.id===session.id).value;
        const signed = signedEvent({id:`evt_motion_${session.id}`,object:"event",type:"checkout.session.completed",data:{object:paid}},"whsec_coach_motion");
        const delivered = await page.request.post("/api/coaching/connect/webhook", { data: signed.payload, headers: { "stripe-signature": signed.signature, "content-type": "application/json" }, timeout: 60_000 });
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
export function captureServices(script: MotionScript, own?: OwnServer): CaptureServices {
  const sentBefore: Record<string, number> = {};
  const mailbox = (address: string) => own ? emailsIn(own.output(), address) : emailsTo(address);
  const services: CaptureServices = {
    files: { "cv-claire-demo.pdf": { name: "CV Claire Démo.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(DEMO_CV_LINES)) } },
    email: async (address, subject) => {
      // Only an email sent since the address was typed: a database kept from an earlier run holds its old ones.
      const before = sentBefore[address] ?? 0;
      await expect.poll(() => mailbox(address).length, { message: `an email to ${address}`, timeout: 30_000 }).toBeGreaterThan(before);
      const email = mailbox(address).at(-1)!;
      if (email.subject !== subject) throw new Error(`the last email to ${address} is « ${email.subject} », not « ${subject} »`);
      // The sign-in email as it was sent (its language is the subject's); any other as its text.
      if (/\/api\/auth\/magic-link\/verify/.test(email.text)) return signInEmail(linkIn(email), script.locale).html;
      return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(subject)}</title><pre style="font:16px/1.5 system-ui;margin:40px;white-space:pre-wrap">${escapeHtml(email.text)}</pre>`;
    },
    typed: (address) => {
      sentBefore[address] = mailbox(address).length;
    },
    pay: payInTestMode,
  };
  if (script.viewer === "guest") {
    buildE2eExtension();
    services.extension = { dir: e2eExtensionDir, id: unpackedExtensionId(e2eExtensionDir), jobOffer: { url: DEMO_JOB_OFFER.url, html: DEMO_JOB_OFFER_HTML } };
  }
  return services;
}

const coachesAdded = new Set<string>();
/** The demo Human Coach, added once by the run's Administrator in the Back Office, for a video that films « Mes coachs humains ». */
export async function addDemoCoach(browser: Browser, own?: OwnServer): Promise<void> {
  const baseURL = own?.origin ?? origin;
  if (coachesAdded.has(baseURL)) return;
  const context = await browser.newContext({ baseURL, locale: "fr-FR" });
  const admin = await context.newPage();
  if (own) await signInByEmail(admin, own, DEMO_ADMINISTRATOR);
  else await signInWithMagicLink(admin, DEMO_ADMINISTRATOR);
  await admin.goto("/admin/coachs");
  if ((await admin.getByText(DEMO_COACH.name, { exact: true }).count()) === 0) {
    await admin.getByLabel("Nom", { exact: true }).fill(DEMO_COACH.name);
    await admin.getByLabel("Adresse e-mail de connexion").fill(DEMO_COACH.email);
    await admin.getByLabel("Lien de réservation Cal.com").fill(DEMO_COACH.bookingUrl);
    await admin.getByRole("button", { name: "Ajouter le coach" }).click();
    await expect(admin.getByRole("status")).toHaveText(`Coach ${DEMO_COACH.name} ajouté.`);
  }
  // Test-only historical Coach fixture: production-created profiles require moderation. Bootstrap the
  // already approved legacy biography in this run's throwaway database, without inventing a legal approval.
  const database = new Pool({ connectionString: own?.databaseUrl ?? process.env.E2E_DATABASE_URL });
  try {
    await database.query("UPDATE human_coach SET public_ready=true,bio=$2 WHERE email=$1", [DEMO_COACH.email, DEMO_COACH.bio]);
    await migrateCoachPages(database);
  } finally {
    await database.end();
  }
  await context.close();
  if (own) {
    const coach = await (await browser.newContext({ baseURL })).newPage();
    try {
      await signInByEmail(coach, own, DEMO_COACH.email);
      await coach.goto("/espace-coach/contrat");
      await coach.getByRole("checkbox").check();
      await coach.getByRole("button", { name: "Accepter le contrat" }).click();
      await expect(coach).toHaveURL(`${baseURL}/espace-coach/aujourdhui`);
      const database = new Pool({ connectionString: own.databaseUrl });
      try {
        const human = (await database.query("SELECT id FROM human_coach WHERE email=$1 AND retired_at IS NULL", [DEMO_COACH.email])).rows[0];
        const seller = (await database.query("INSERT INTO coaching_seller(kind,name,status,siret,coach_id) VALUES('human_coach',$1,'EI','12345678901234',$2) RETURNING id", [DEMO_COACH.name, human.id])).rows[0];
        await database.query("INSERT INTO coaching_offer(coach_id,seller_id,payout_seller_id,coach_share_bps) SELECT $1,id,$2,8000 FROM coaching_seller WHERE kind='jobbbox' ON CONFLICT(coach_id) DO UPDATE SET payout_seller_id=$2,coach_share_bps=8000", [human.id, seller.id]);
        const identity = {kind: "individual",legalName: DEMO_COACH.name,firstName:"Synthetic",lastName:"Coach",birthDate:"1980-01-01",residence:"FR",tin:"12345678901234",tinCountry:"FR",siret:"12345678901234",street:"1 rue Test",postalCode:"75001",city:"Paris",addressCountry:"FR",iban:"FR7630006000011234567890189",accountHolder:"Synthetic Coach"};
        const saved = await coach.request.put("/api/account/coaching/tax-identity", { headers: {origin: baseURL}, data: {sellerId:seller.id,year:2026,identity} });
        expect(saved.status(),await saved.text()).toBe(200);
        const remote = await (await fetch(`${stripeUrl}/v1/accounts`, {method:"POST",body:new URLSearchParams({type:"express",country:"FR","metadata[jobhub_seller]":seller.id})})).json();
        const person = (await (await coach.request.get("/api/auth/get-session")).json()).user;
        await database.query("INSERT INTO coaching_connect_account(seller_id,account_id,created_at,owner_id) VALUES($1,$2,now(),$3)",[seller.id,remote.id,person.id]);
        await fetch(`${stripeUrl}/__connect/activate`,{method:"POST",body:new URLSearchParams({account:remote.id})});
      } finally { await database.end(); }
    } finally { await coach.context().close(); }
  }
  coachesAdded.add(baseURL);
}
