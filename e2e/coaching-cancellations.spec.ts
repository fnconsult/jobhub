import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { test, expect, type Browser } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { newAddress } from "./support/mailbox";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { platformSettingsStore } from "../apps/web/src/platform-settings";
import { migrateCoachPages } from "../apps/web/src/coach-pages";
import { checkoutSessionEvent, signedEvent } from "../apps/web/src/billing/fake-stripe";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  ADMIN = "booking-office@e2e.jobbbox.test",
  SECRET = "cal-webhook-e2e-secret",
  NAME = "Cancel Coach";
let own: OwnServer,
  database: Pool,
  remote: Server,
  remoteUrl: string;
const remoteFails = false;
const cancelled = new Set<string>();
const SDK = `(()=>{const old=window.Cal;const callbacks={};const dispatch=args=>{if(args[0]==="on"){callbacks[args[1].action]=args[1].callback;return;}if(args[0]==="off"){delete callbacks[args[1].action];return;}if(args[0]!=="inline")return;const v=args[1],root=typeof v.elementOrSelector==="string"?document.querySelector(v.elementOrSelector):v.elementOrSelector;if(!root)return;const button=document.createElement("button");button.textContent="Fake Cal slot";button.dataset.testid="fake-cal-slot";button.dataset.token=v.config?.["metadata[jobbbox_session]"]||"";button.onclick=async()=>{await window.__jobhubFakeCalBook?.(button.dataset.token);callbacks.bookingSuccessfulV2?.();};root.appendChild(button);};const api=(...args)=>{if(args[0]==="init"&&typeof args[1]==="string")api.ns[args[1]]||=(...values)=>dispatch(values);else dispatch(args);};api.ns={};for(const [name,value] of Object.entries(old.ns||{})){api.ns[name]=(...args)=>dispatch(args);for(const args of value.q||[])dispatch(args);}for(const args of old.q||[])dispatch(args);api.loaded=true;window.Cal=api;})();`;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await page.route("https://app.cal.com/embed/embed.js", (route) => route.fulfill({ contentType: "application/javascript", body: SDK }));
  await signInByEmail(page, own, email);
  return page;
}
test.beforeAll(async () => {
  remote = createServer((req, res) => {
    if (remoteFails) {
      res.writeHead(503).end();
      return;
    }
    const uid = req.url?.split("/")[3];
    if (req.method === "POST" && req.url?.endsWith("/cancel") && uid) cancelled.add(uid);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        status: "success",
        data: req.url?.includes("/bookings/")
          ? { uid, status: cancelled.has(uid ?? "") ? "cancelled" : "accepted" }
          : {
              id: 42,
              teamId: 7,
              hosts: [{ userId: 8 }],
              lengthInMinutes: 60,
              bookingUrl: "https://cal.com/team/jobbbox/coach",
              schedulingType: "collective",
              disableRescheduling: { disabled: false, minutesBefore: 1440 },
            },
      }),
    );
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("No fake Cal listener");
  remoteUrl = `http://127.0.0.1:${address.port}`;
  own = await startOwnServer(883, "coaching_cancellations", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "booking-e2e-auth-secret-booking-e2e-secret",
    MAIL_TRANSPORT: "console",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_CONNECT_WEBHOOK_SECRET:"whsec_connect_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    CAL_COM_API_KEY: "test-cal-key",
    CAL_COM_WEBHOOK_SECRET: SECRET,
    E2E_CAL_URL: remoteUrl,
    NODE_OPTIONS: [
      "fake-coach-contract.mjs",
      "fake-coaching-legal.mjs",
      "fake-cal.mjs",
      "fake-cancellation-legal.mjs",
      "fake-google.mjs",
      "fake-mistral.mjs",
      "fake-reference-data.mjs",
    ]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
  const settings = platformSettingsStore(database, {});
  for (const [name, value] of [
    ["COACH_SPACE_V2_ENABLED", "true"],
    ["CAL_COM_TEAM_ID", "7"],
    ["CAL_COM_REMINDERS_DISABLED", "true"],
  ])
    await settings.set(name, value, ADMIN);
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
  await new Promise<void>((resolve) => remote?.close(() => resolve()));
});
test("Coach cancellation offers refund, same paid service and explicit affordable Peer Order at 390px", async ({ browser }) => {
  test.setTimeout(180000);
  const email = newAddress("cancel-coach"),
    peerEmail = newAddress("cancel-peer"),
    buyerEmail = newAddress("cancel-buyer");
  const coach = (
    await database.query(
      "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Cancel Coach',$1,'https://cal.eu/legacy/coach','Approved cancellation coach profile',true) RETURNING id",
      [email],
    )
  ).rows[0].id;
  const peer = (
    await database.query(
      "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Affordable Peer',$1,'https://cal.eu/legacy/peer','Approved peer coaching profile',true) RETURNING id",
      [peerEmail],
    )
  ).rows[0].id;
  await migrateCoachPages(database);
  const owner = await account(browser, email),
    peerOwner = await account(browser, peerEmail),
    admin = await account(browser, ADMIN),
    buyer = await account(browser, buyerEmail);
  try {
    for (const page of [owner, peerOwner]) {
      await page.goto("/espace-coach/disponibilites");
      await setUpTwoStepVerificationIfAsked(page);
      await page.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
      await page.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    }
    await admin.goto("/admin/coachs");
    const section = admin.locator("section").filter({ has: admin.getByRole("heading", { name: fr.coachingBooking.adminTitle, exact: true }) });
    const create = section
      .locator(".coach-space-card")
      .filter({ has: admin.getByRole("heading", { name: NAME, exact: true }) })
      .locator("form")
      .filter({ has: admin.getByRole("button", { name: fr.coachingBooking.create, exact: true }) });
    await create.getByLabel(fr.coachingBooking.hostId, { exact: true }).fill("8");
    await create.getByLabel(fr.coachingBooking.duration, { exact: true }).fill("60");
    await create.getByRole("button").click();
    await expect(admin).toHaveURL(/booking=created/);
    const candidate = (await database.query("SELECT id FROM candidate WHERE email=$1", [buyerEmail])).rows[0].id;
    const peerOwnerId=(await database.query('SELECT id FROM candidate WHERE email=$1',[peerEmail])).rows[0].id;
    const seller=(await database.query("INSERT INTO coaching_seller(kind,coach_id,name,status,siret,commission_bps) VALUES('human_coach',$1,'Affordable Peer EI','EI','12345678901234',2000) RETURNING id",[peer])).rows[0].id;
    const accountResponse=await fetch(`${process.env.E2E_STRIPE_URL}/v1/accounts`,{method:'POST',body:new URLSearchParams({type:'express','metadata[seller]':seller})});
    const connected=await accountResponse.json();
    await database.query('INSERT INTO coaching_connect_account(seller_id,account_id,owner_id,created_at) VALUES($1,$2,$3,clock_timestamp())',[seller,connected.id,peerOwnerId]);
    await fetch(`${process.env.E2E_STRIPE_URL}/__connect/activate`,{method:'POST',body:new URLSearchParams({account:connected.id})});
    await database.query('UPDATE coaching_offer SET seller_id=$2,amount=8000 WHERE coach_id=$1',[peer,seller]);
    async function paid(name: string) {
      const checkout = `cs_e2e_remedy_${name}_${Date.now()}`;
      await fetch(`${process.env.E2E_STRIPE_URL}/__checkout_sessions/${checkout}/payment`, { method: "POST", body: new URLSearchParams({ amount: "9000" }) });
      const signed = signedEvent(
        checkoutSessionEvent("checkout.session.completed", {
          id: checkout,
          candidateId: candidate,
          coachId: coach,
          amount: 9000,
          currency: "eur",
          paymentStatus: "paid",
        }),
      );
      expect(
        (
          await buyer.request.post("/api/billing/webhook", {
            data: signed.payload,
            headers: { "stripe-signature": signed.signature, "content-type": "application/json" },
          })
        ).status(),
      ).toBe(200);
      return (await database.query("SELECT id FROM coaching_session WHERE stripe_checkout_session_id=$1", [checkout])).rows[0].id as string;
    }
    await buyer.setViewportSize({ width: 390, height: 844 });
    for (const [suffix, choice] of [
      ["refund-flow", "refund"],
      ["same-flow", "same"],
      ["peer-flow", "peer"],
    ] as const) {
      const id = await paid(suffix);
      await owner.goto(`/espace-coach/seances/${id}`);
      await owner.getByRole("button", { name: fr.coachingCancellation.cancelCoach, exact: true }).click();
      await owner.getByLabel(fr.coachingCancellation.reason, { exact: true }).fill(suffix);
      await owner.getByRole("button", { name: fr.coachingCancellation.confirmCoach, exact: true }).click();
      await expect(async () => {
        expect((await database.query("SELECT count(*)::int AS n FROM coaching_cancellation WHERE session_id=$1", [id])).rows[0].n).toBe(1);
      }).toPass();
      await buyer.goto("/coachs/annulations");
      const card = buyer.locator("article").filter({ has: buyer.getByText(suffix, { exact: true }) });
      await expect(card).toContainText(fr.coachingCancellation.choices);
      if (choice === "refund") {
        await card.getByRole("button", { name: fr.coachingCancellation.refund, exact: true }).click();
        await expect(card).toContainText(fr.coachingCancellation.refunded);
      }
      if (choice === "same") {
        await card.getByRole("button", { name: fr.coachingCancellation.same, exact: true }).click();
        await card.getByRole("link", { name: fr.coachingCancellation.bookSame, exact: true }).click();
        await expect(buyer.getByTestId("fake-cal-slot")).toBeVisible();
        await buyer.exposeFunction("__jobhubFakeCalBook", async (token: string) => {
          const at = new Date(Date.now() + 10 * 86400000),
            raw = JSON.stringify({
              triggerEvent: "BOOKING_CREATED",
              createdAt: new Date().toISOString(),
              payload: {
                uid: `remedy_${Date.now()}`,
                eventTypeId: 42,
                startTime: at.toISOString(),
                endTime: new Date(at.getTime() + 3600000).toISOString(),
                metadata: { jobbbox_session: token },
              },
            });
          expect(
            (
              await buyer.request.post("/api/coaching/booking/webhook", {
                data: raw,
                headers: { "x-cal-signature-256": createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" },
              })
            ).status(),
          ).toBe(200);
        });
        await buyer.getByTestId("fake-cal-slot").click();
        await expect(buyer.getByTestId("fake-cal-slot")).toHaveCount(0);
        expect((await database.query("SELECT count(*)::int AS n FROM coaching_service_refund WHERE session_id=$1", [id])).rows[0].n).toBe(0);
      }
      if (choice === "peer") {
        await card.getByRole("button", { name: fr.coachingCancellation.choosePeer.replace("{{name}}", "Affordable Peer"), exact: true }).click();
        await expect(card).toContainText(fr.coachingCancellation.refunded);
        await card.getByRole("link", { name: fr.coachingCancellation.newOrder, exact: true }).click();
        await expect(buyer).toHaveURL(new RegExp(`coach=${peer}`));
        await expect(buyer.locator("body")).toContainText("Affordable Peer");
        await expect(buyer.locator("form")).toHaveCount(1);
      }
    }
    await buyer.goto("/coachs/annulations");
    expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await buyer.screenshot({ path: "/tmp/coaching-cancellations-390.png", fullPage: true });
  } finally {
    await Promise.all([owner.context().close(), peerOwner.context().close(), admin.context().close(), buyer.context().close()]);
  }
});
