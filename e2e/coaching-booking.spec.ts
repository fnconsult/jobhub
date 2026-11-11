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
import { coachingBooking } from "../apps/web/src/coaching-booking";
import { calTeam } from "../apps/web/src/coaching-booking/cal";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  ADMIN = "booking-office@e2e.jobbbox.test",
  SECRET = "cal-webhook-e2e-secret",
  NAME = "Coach Cal Équipe";
let own: OwnServer,
  database: Pool,
  remote: Server,
  remoteUrl: string,
  remoteFails = false;
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
          : { id: 42, teamId: 7, hosts: [{ userId: 8 }], lengthInMinutes: 60, bookingUrl: "https://cal.com/team/jobbbox/coach", schedulingType: "collective" },
      }),
    );
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("No fake Cal listener");
  remoteUrl = `http://127.0.0.1:${address.port}`;
  own = await startOwnServer(881, "coaching_booking", {
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
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    CAL_COM_API_KEY: "test-cal-key",
    CAL_COM_WEBHOOK_SECRET: SECRET,
    E2E_CAL_URL: remoteUrl,
    NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-coaching-legal.mjs", "fake-cal.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
  const settings = platformSettingsStore(database, {});
  for (const [name, value] of [
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
test("paid return embeds a signed claim; Cal moves/cancels the Agenda and Withdrawal refunds during a Cal outage", async ({ browser }) => {
  test.setTimeout(180000);
  const email = newAddress("cal-coach"),
    buyerEmail = newAddress("cal-buyer"),
    coach = (
      await database.query(
        "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES($1,$2,'https://cal.eu/legacy/coach','Approved professional profile',true) RETURNING id",
        [NAME, email],
      )
    ).rows[0].id;
  await migrateCoachPages(database);
  const owner = await account(browser, email),
    admin = await account(browser, ADMIN),
    buyer = await account(browser, buyerEmail),
    outsider = await account(browser, newAddress("cal-outsider"));
  try {
    await owner.goto("/espace-coach/disponibilites");
    await setUpTwoStepVerificationIfAsked(owner);
    await owner.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await owner.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await admin.goto("/admin/coachs");
    const section = admin.locator("section").filter({ has: admin.getByRole("heading", { name: fr.coachingBooking.adminTitle, exact: true }) });
    await expect(section).toContainText(fr.coachingBooking.reviewLegacy);
    const create = section.locator("form").filter({ has: admin.getByRole("button", { name: fr.coachingBooking.create, exact: true }) });
    await create.getByLabel(fr.coachingBooking.hostId, { exact: true }).fill("8");
    await create.getByLabel(fr.coachingBooking.duration, { exact: true }).fill("60");
    await create.getByRole("button").click();
    await expect(admin).toHaveURL(/booking=created/);
    await owner.goto("/espace-coach/disponibilites");
    await expect(owner.getByTestId("fake-cal-slot")).toBeVisible();
    expect(await owner.getByTestId("fake-cal-slot").getAttribute("data-token")).toBe("");
    const candidate = (await database.query("SELECT id FROM candidate WHERE email=$1", [buyerEmail])).rows[0].id;
    async function paid(suffix: string) {
      const checkout = `cs_e2e_cal_${suffix}_${Date.now()}`;
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
      return { checkout, id: (await database.query("SELECT id FROM coaching_session WHERE stripe_checkout_session_id=$1", [checkout])).rows[0].id };
    }
    await buyer.setViewportSize({ width: 390, height: 844 });
    const first = await paid("first");
    await buyer.goto(`/coachs?session=paid&checkout_id=${first.checkout}`);
    await expect(buyer.getByTestId("fake-cal-slot")).toBeVisible();
    expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await buyer.screenshot({ path: "/tmp/coaching-booking-390.png", fullPage: true });
    const token = await buyer.getByTestId("fake-cal-slot").getAttribute("data-token");
    expect(token).toBeTruthy();
    const start = new Date(Math.floor((Date.now() + 14 * 86400000) / 60000) * 60000),
      later = new Date(start.getTime() + 2 * 86400000);
    let sequence = 0;
    async function delivery(kind: string, uid: string, claim: string | null, at: Date, extra: Record<string, unknown> = {}, providerAt?: Date) {
      const raw = JSON.stringify({
        triggerEvent: kind,
        createdAt: (providerAt ?? new Date(Date.now() + sequence++ * 10)).toISOString(),
        payload: {
          uid,
          eventTypeId: 42,
          startTime: at.toISOString(),
          endTime: new Date(at.getTime() + 3600000).toISOString(),
          metadata: { jobbbox_session: claim },
          ...extra,
        },
      });
      const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
      return () =>
        buyer.request.post("/api/coaching/booking/webhook", { data: raw, headers: { "x-cal-signature-256": signature, "content-type": "application/json" } });
    }
    const created = await delivery("BOOKING_CREATED", "cal_first", token, start);
    let bookNow = async () => {
      expect((await Promise.all([created(), created()])).map((r) => r.status())).toEqual([200, 200]);
    };
    await buyer.exposeFunction("__jobhubFakeCalBook", () => bookNow());
    await buyer.getByTestId("fake-cal-slot").click();
    await expect(buyer.getByTestId("fake-cal-slot")).toHaveCount(0);

    await buyer.goto("/agenda");
    await expect(buyer.locator("body")).toContainText(NAME);
    const causal = Date.now() + 1000;
    const successor = await delivery("BOOKING_RESCHEDULED", "cal_final", null, later, { rescheduleUid: "cal_moved" }, new Date(causal + 200));
    expect((await successor()).status()).toBe(200);
    expect((await database.query("SELECT count(*)::int AS n FROM coaching_cal_pending")).rows[0].n).toBe(1);
    const moved = await delivery(
      "BOOKING_RESCHEDULED",
      "cal_moved",
      null,
      new Date(start.getTime() + 86400000),
      { rescheduleUid: "cal_first" },
      new Date(causal + 100),
    );
    expect((await moved()).status()).toBe(200);
    expect((await database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [first.id])).rows[0].scheduled_at).toEqual(later);
    await buyer.goto("/coachs");
    await expect(buyer.locator("body")).toContainText(fr.coachingBooking.viaCal);
    expect((await outsider.request.get(`/coachs/seances/${first.id}/reserver`)).status()).toBe(404);
    const manual = await buyer.request.patch(`/api/coaching/sessions/${first.id}`, {
      headers: { origin: own.origin },
      data: { scheduledAt: "2030-05-01T12:00" },
    });
    expect(manual.status()).toBe(409);
    const sameDate = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(later)
      .replace(" ", "T");
    for (const person of [buyer, owner]) {
      const route = person === buyer ? "/api/coaching/sessions" : "/api/coach-space/sessions";
      const durationOnly = await person.request.patch(`${route}/${first.id}`, {
        headers: { origin: own.origin },
        data: { scheduledAt: sameDate, durationMinutes: 30 },
      });
      expect(durationOnly.status()).toBe(409);
    }
    expect((await database.query("SELECT duration_minutes FROM coaching_session WHERE id=$1", [first.id])).rows[0].duration_minutes ?? 60).toBe(60);
    const second = await paid("second");
    await buyer.goto(`/coachs/seances/${second.id}/reserver`);
    const token2 = await buyer.getByTestId("fake-cal-slot").getAttribute("data-token");
    bookNow = async () => {
      await (
        await delivery("BOOKING_CREATED", "cal_second", token2, start)
      )();
    };
    await buyer.getByTestId("fake-cal-slot").click();
    await expect(buyer.getByTestId("fake-cal-slot")).toHaveCount(0);
    await (
      await delivery("BOOKING_CANCELLED", "cal_second", null, start)
    )();
    expect((await database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [second.id])).rows[0].scheduled_at).toBeNull();
    remoteFails = true;
    await buyer.goto(`/abonnement/retractation?contrat=coaching-session:${first.id}`);
    await buyer.getByLabel(fr.withdrawals.page.name).fill("Marie Cal");
    await buyer.getByRole("button", { name: fr.withdrawals.page.confirm }).click();
    await expect(buyer.getByRole("status")).toContainText(/90,00\s€/);
    expect((await database.query("SELECT status FROM withdrawal_refund")).rows[0].status).toBe("succeeded");
    const closedCausal = Date.now() + 1000;
    await (
      await delivery("BOOKING_RESCHEDULED", "cal_closed_C", token, later, { rescheduleUid: "cal_closed_B" }, new Date(closedCausal + 200))
    )();
    await (
      await delivery("BOOKING_RESCHEDULED", "cal_closed_B", token, later, { rescheduleUid: "cal_final" }, new Date(closedCausal + 100))
    )();
    expect((await database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [first.id])).rows[0].scheduled_at).toBeNull();
    expect((await database.query("SELECT uid,state FROM coaching_cal_booking WHERE session_id=$1", [first.id])).rows[0]).toEqual({
      uid: "cal_closed_C",
      state: "closing",
    });
    const worker = coachingBooking(database, {
      secret: "test",
      webhookSecret: SECRET,
      cal: calTeam({ apiKey: "test", fetch: (url, init) => fetch(`${remoteUrl}${new URL(String(url)).pathname}`, init) }),
    });
    await worker.deliverCancellations();
    expect(cancelled.has("cal_final")).toBe(false);
    remoteFails = false;
    await database.query("UPDATE coaching_cal_cancellation SET retry_at=NULL");
    await worker.deliverCancellations();
    expect(cancelled.has("cal_final")).toBe(true);
    expect(cancelled.has("cal_closed_C")).toBe(true);
  } finally {
    remoteFails = false;
    await Promise.all([owner, admin, buyer, outsider].map((page) => page.context().close()));
  }
});
