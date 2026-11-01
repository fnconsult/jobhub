import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { checkoutSessionEvent, fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { fromNewAddress, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { emailsIn, emailsTo, linkIn, newAddress, type Email } from "./support/mailbox";
import { configuredStripe, startServer, type PlanPricesServer } from "./support/plan-prices";
import { submitToStripe } from "./support/stripe-checkout";

// Issue #512: the Order page before Stripe Checkout. Choose a Plan, tick, pay (the fake Stripe and its signed webhook),
// get the Order Confirmation, once. On the suite's own server, built with no CGV version, only the Immediate Performance
// Request is asked. With a CGV version, on a second server of the app (`next dev`, on the suite's database and fake
// Stripe), the CGV box is required by the server, and the Acceptance is written with its Checkout Session. As in
// acceptances.spec.ts, the fixture version is written into packages/help/legal/cgv/, the generated module rebuilt,
// and both restored afterwards; no fixture is ever committed. In the root-env project, one spec at a time.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const orders = fr.orders;
const suiteOrigin = process.env.E2E_WEB_ORIGIN!;
const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
const cgvDir = path.resolve("packages/help/legal/cgv");
const generated = path.resolve("packages/help/src/legal-texts.generated.ts");
const CGV = "2025-01-01";
/** Intl puts (narrow) no-break spaces in amounts; read them as plain spaces. */
const plain = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

const candidateIdOf = async (email: string) => (await database.query<{ id: string }>("SELECT id FROM candidate WHERE email = $1", [email])).rows[0]!.id;
const checkoutSessionsOf = async (email: string) =>
  ((await (await fetch(`${process.env.E2E_STRIPE_URL}/__calls`)).json()) as { path: string; params: Record<string, string> }[]).filter(
    (call) => call.path === "/v1/checkout/sessions" && call.params.customer === fakeCustomerId(email),
  );

/** Stripe's signed webhook reporting the Checkout paid and the subscription it started, delivered to `origin`. */
async function payThroughStripe(request: APIRequestContext, origin: string, email: string, checkoutSessionId: string) {
  const customer = fakeCustomerId(email);
  const subscription = `sub_fake_${customer}`;
  const candidateId = await candidateIdOf(email);
  for (const event of [
    subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }),
    checkoutSessionEvent("checkout.session.completed", { id: checkoutSessionId, candidateId, amount: 1900, currency: "eur", paymentStatus: "paid", mode: "subscription", subscription }),
  ]) {
    const { payload, signature } = signedEvent(event);
    const delivered = await request.post(`${origin}/api/billing/webhook`, { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);
  }
}

/** The Order page of Standard, reached from « Choisir l'offre Standard » on Mon abonnement. */
async function orderStandard(page: Page) {
  // `next dev` compiles each page on its first visit: give it time.
  await page.goto("/abonnement", { timeout: 120_000 });
  await Promise.all([page.waitForURL(/\/abonnement\/commande\?offre=standard$/, { timeout: 120_000 }), page.getByRole("button", { name: "Choisir l'offre Standard" }).click()]);
  await expect(page.getByRole("heading", { level: 2, name: orders.page.title })).toBeVisible();
  const summary = page.locator(".ds-props");
  await expect(summary).toContainText("Offre Standard");
  expect(plain(await summary.innerText())).toMatch(/19,00 € TTC par mois/);
  await expect(summary).toContainText("Abonnement reconduit automatiquement chaque mois, jusqu'à sa résiliation");
  const immediate = page.getByRole("checkbox", { name: orders.page.immediatePlan });
  await expect(immediate).not.toBeChecked();
  return { immediate };
}

/** The checkout session id at the end of Stripe Checkout's address. */
const checkoutSessionIn = (location: string) => {
  expect(location).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_/);
  return location.split("/").at(-1)!;
};

const confirmations = (emails: Email[]) => emails.filter((email) => email.subject === "Confirmation de votre commande : offre Standard");

test.describe("La page avant Checkout (#512)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.afterAll(async () => {
    await database.end();
  });

  test("choisir un Plan, cocher, payer : la confirmation de commande arrive une fois, sans case CGV tant qu'aucune version n'est en vigueur", async ({ browser }) => {
    const email = newAddress("commande");
    const context = await browser.newContext({ baseURL: suiteOrigin, locale: "fr-FR" });
    const page = await context.newPage();
    await signInWithMagicLink(page, email);
    const { immediate } = await orderStandard(page);
    await expect(page.getByRole("checkbox", { name: /CGV/ })).toHaveCount(0);

    await immediate.check();
    const answer = await submitToStripe(page, "/api/billing/checkout", orders.page.submit);
    expect(answer.status()).toBe(303);
    const checkoutSessionId = checkoutSessionIn(answer.headers().location!);
    expect(await checkoutSessionsOf(email)).toHaveLength(1);

    await payThroughStripe(page.request, suiteOrigin, email, checkoutSessionId);
    await payThroughStripe(page.request, suiteOrigin, email, checkoutSessionId); // Stripe delivers again.

    await expect.poll(() => confirmations(emailsTo(email)).length, { message: "Order Confirmation" }).toBe(1);
    const [confirmation] = confirmations(emailsTo(email));
    expect(plain(confirmation!.text)).toContain("Prix : 19,00 € TTC par mois");
    expect(confirmation!.text).toContain("Vous avez demandé que le service commence immédiatement");
    expect(confirmation!.text).toContain(`${suiteOrigin}/abonnement/retractation?contrat=plan`);
    expect(confirmation!.text).not.toContain("CGV");
    // No CGV version, no Acceptance: the Immediate Performance Request is kept with the Order.
    expect((await database.query("SELECT 1 FROM legal_acceptance WHERE checkout_session_id = $1", [checkoutSessionId])).rows).toEqual([]);
    expect((await database.query("SELECT immediate_execution_requested FROM checkout_order WHERE checkout_session_id = $1", [checkoutSessionId])).rows).toEqual([
      { immediate_execution_requested: true },
    ]);
    await context.close();
  });

  test.describe("avec une version des CGV en vigueur", () => {
    let server: PlanPricesServer;
    let savedGenerated = "";
    test.beforeAll(async () => {
      savedGenerated = readFileSync(generated, "utf8");
      writeVersion();
      const built = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });
      expect(built.status, built.stdout + built.stderr).toBe(0);
      server = await startServer(512, { ...configuredStripe, STRIPE_API_URL: process.env.E2E_STRIPE_URL }, "dev");
    });
    test.afterAll(() => {
      server?.stop();
      clearVersions();
      writeFileSync(generated, savedGenerated);
    });

    test("sans la case CGV, aucune session Checkout ; cochée, la table d'acceptations garde la version, la session Checkout et la demande expresse, et la confirmation lie la version", async ({ browser }) => {
      const email = newAddress("commande-cgv");
      const page = await signInOn(browser, server, email);
      const { immediate } = await orderStandard(page);
      const cgvBox = page.getByRole("checkbox", { name: tr(orders.page.cgvBox, { date: "01/01/2025" }) });
      await expect(cgvBox).not.toBeChecked();
      await expect(page.getByRole("link", { name: tr(orders.page.readCgv, { date: "01/01/2025" }) })).toHaveAttribute("href", `/legal/cgv/${CGV}`);

      // The server checks the box, not the browser: a form posted without it is sent back, and no Checkout Session is created.
      const unticked = await page.request.post("/api/billing/checkout", { form: { plan: "standard", immediateExecution: "yes" }, headers: { origin: server.origin }, maxRedirects: 0 });
      expect(unticked.status()).toBe(303);
      expect(unticked.headers().location).toBe(`${server.origin}/abonnement/commande?offre=standard&erreur=cgv`);
      expect(await checkoutSessionsOf(email)).toEqual([]);
      await page.goto(unticked.headers().location!);
      // Scoped to the main landmark: Next.js keeps its own role=alert route announcer outside it.
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(orders.page.cgvRequired);

      await cgvBox.check();
      await immediate.check();
      const answer = await submitToStripe(page, "/api/billing/checkout", orders.page.submit);
      expect(answer.status()).toBe(303);
      const checkoutSessionId = checkoutSessionIn(answer.headers().location!);

      const { rows } = await database.query("SELECT text, version, channel, checkout_session_id, immediate_execution_requested FROM legal_acceptance WHERE candidate_id = $1", [await candidateIdOf(email)]);
      expect(rows).toEqual([{ text: "cgv", version: CGV, channel: "paiement_plan", checkout_session_id: checkoutSessionId, immediate_execution_requested: true }]);

      await payThroughStripe(page.request, server.origin, email, checkoutSessionId);
      await expect.poll(() => confirmations(emailsIn(server.output(), email)).length, { message: "Order Confirmation" }).toBe(1);
      const [confirmation] = confirmations(emailsIn(server.output(), email));
      expect(confirmation!.text).toContain("CGV (version du 01/01/2025)");
      expect(confirmation!.text).toContain(`${server.origin}/legal/cgv/${CGV}`);
      expect(confirmation!.text).toContain(`${server.origin}/legal/cgv/${CGV}#retractation`);
      await page.context().close();
    });
  });
});

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

function clearVersions() {
  rmSync(cgvDir, { recursive: true, force: true });
  mkdirSync(cgvDir, { recursive: true });
  writeFileSync(path.join(cgvDir, ".gitkeep"), "");
}

/** A CGV version in effect since 1 January 2025, in both languages, with its withdrawal form section. */
function writeVersion() {
  clearVersions();
  for (const locale of ["fr", "en"] as const) {
    const front = [
      `title: ${locale === "fr" ? "Conditions générales de vente" : "Terms of sale"}`,
      `effective: ${CGV}`,
      "change: substantielle",
      "approved_by: Camille Martin",
      `summary: ${locale === "fr" ? "Première version." : "First version."}`,
    ].join("\n");
    const body =
      locale === "fr"
        ? "## Objet\nTexte français des CGV.\n\n## Rétractation {#retractation}\nFormulaire type de rétractation.\n"
        : "## Purpose\nEnglish text of the terms of sale.\n\n## Withdrawal {#retractation}\nModel withdrawal form.\n";
    writeFileSync(path.join(cgvDir, `${CGV}.${locale}.md`), `---\n${front}\n---\n${body}`);
  }
}

/** Signs `email` in on `server` the way a person does: the sign-in page, then the link the server emailed. */
async function signInOn(browser: Browser, server: PlanPricesServer, email: string): Promise<Page> {
  const already = emailsIn(server.output(), email).length;
  const page = await (await browser.newContext({ baseURL: server.origin, locale: "fr-FR" })).newPage();
  await fromNewAddress(page);
  await page.goto("/connexion", { timeout: 120_000 });
  await requestSignInLink(page, email);
  await expect.poll(() => emailsIn(server.output(), email).length, { message: `sign-in email to ${email}` }).toBeGreaterThan(already);
  await page.goto(linkIn(emailsIn(server.output(), email)[already]!), { timeout: 120_000 });
  return page;
}
