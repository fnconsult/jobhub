// The web app's Mes coachs humains routes for the e2e tests (#694), as apps/web/src/app/api/coaching answers them, only
// to a request carrying the signed-in Candidate's session cookie (401 otherwise): `GET /api/coaching`, the Order page
// (`GET /api/coaching/order?coach=`) and « Passer au paiement » (`POST /api/coaching/order`, the CGV box checked as
// Orders.place does), and a Coaching Session's date (`PATCH /api/coaching/sessions/:id`, refused as the web refuses it).
// Stripe's signed webhook is `paid()`: the only way a Coaching Session is recorded (ADR-0016). Every other request goes
// on to the fake web app's session endpoints.
import type { CoachingOrderResponse, CoachingResponse } from "@jobhub/shared/reads";
import type { fakeWebApp } from "../src/session/testing";

type Session = CoachingResponse["sessions"][number];

/** The CGV version in effect. */
export const CGV_VERSION = "2026-10-01";
/** Where Stripe Checkout opens: the Checkout Session the web app created. */
export const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_coaching";

const CLAIRE = { id: "coach-1", name: "Claire Martin", bookingUrl: "https://cal.com/claire-martin" };
const PAUL = { id: "coach-2", name: "Paul Durand", bookingUrl: "https://cal.com/paul-durand" };

/** Marie's Human Coaches and Coaching Sessions: one dated with Claire (changed by her), one with Paul to schedule. */
export function coaching(): CoachingResponse {
  return {
    coaches: [
      { id: CLAIRE.id, name: CLAIRE.name, bio: "Coach carrière, 15 ans de RH.", accessGranted: true },
      { id: PAUL.id, name: PAUL.name, bio: "Ancien DRH, spécialiste des cadres.", accessGranted: false },
    ],
    sessions: [
      {
        id: "s1",
        coach: CLAIRE,
        paidAt: "2026-10-10T08:00:00.000Z",
        scheduledAt: "2026-10-23T09:00:00.000Z",
        durationMinutes: 60,
        videoLink: "https://meet.google.com/exemple",
        note: "Préparer l'entretien Aéroline",
        changedBy: "coach",
        reschedules: [],
        withdrawable: false,
      },
      { id: "s2", coach: PAUL, paidAt: "2026-10-18T08:00:00.000Z", scheduledAt: null, durationMinutes: null, videoLink: null, note: null, changedBy: null, reschedules: [], withdrawable: true },
    ],
    price: { amount: 7200, regularAmount: 9000, currency: "eur" },
  };
}

/** A body as the app sent it. */
type Body = Record<string, unknown>;

/** `scheduledAt` as the web reads it: French time without an offset, "2026-11-12T14:30". */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The errors the web's Coaching Session form gets back (human-coaches' scheduleSession), on the fields the app sent. */
function refusals(body: Body): { field: string; code: string }[] {
  const errors: { field: string; code: string }[] = [];
  const at = typeof body.scheduledAt === "string" ? body.scheduledAt : "";
  const parts = WALL_CLOCK.exec(at);
  if (!at) errors.push({ field: "scheduledAt", code: "required" });
  else if (!parts || Number(parts[2]) > 12 || Number(parts[3]) > 31 || Number(parts[4]) > 23 || Number(parts[5]) > 59) errors.push({ field: "scheduledAt", code: "invalid" });
  const duration = body.durationMinutes;
  if (duration !== null && duration !== undefined && (typeof duration !== "number" || !Number.isInteger(duration) || duration < 5 || duration > 600)) errors.push({ field: "durationMinutes", code: "invalid" });
  if (typeof body.videoLink === "string" && body.videoLink !== "" && !/^https?:\/\//.test(body.videoLink)) errors.push({ field: "videoLink", code: "invalid" });
  if (typeof body.note === "string" && body.note.length > 500) errors.push({ field: "note", code: "too_long" });
  return errors;
}

/** "2026-11-12T14:30" in French time (winter: UTC+1, summer: UTC+2, from the last Sunday of March and of October). */
function fromParis(wallClock: string): string {
  const asUtc = new Date(`${wallClock}:00.000Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(asUtc).find((part) => part.type === "timeZoneName")!.value;
  const hours = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 0);
  return new Date(asUtc.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** What a test reads and changes of the web app's coaching routes. */
interface CoachingRoute {
  coaching: CoachingResponse;
  cgv: CoachingOrderResponse["cgv"];
  checkout: { status: number };
  orders: Body[];
  edits: { id: string; body: Body }[];
  /** How many times `GET /api/coaching` was asked. */
  reads: number;
  /** Stripe's signed webhook: the Coaching Session paid with `coachId` is recorded. */
  paid(coachId: string, id?: string): Session;
}

/**
 * Serves Mes coachs humains at the network (the global fetch the app's API calls go through), to `email`'s session.
 * `checkout` is what « Passer au paiement » answers (200 with Stripe's address, or an error); `orders` what it was sent;
 * `paid(coachId)` is Stripe's webhook recording a Coaching Session. Undone by `jest.restoreAllMocks()`.
 */
export function serveCoaching(web: ReturnType<typeof fakeWebApp>, email: string) {
  const route: CoachingRoute = {
    coaching: coaching(),
    cgv: { version: CGV_VERSION, url: `/legal/cgv/${CGV_VERSION}` },
    checkout: { status: 200 },
    orders: [],
    edits: [],
    reads: 0,
    paid(coachId, id = `paid-${route.coaching.sessions.length + 1}`) {
      const coach = [CLAIRE, PAUL].find((each) => each.id === coachId)!;
      const session: Session = { id, coach, paidAt: new Date().toISOString(), scheduledAt: null, durationMinutes: null, videoLink: null, note: null, changedBy: null, reschedules: [], withdrawable: true };
      route.coaching = { ...route.coaching, sessions: [...route.coaching.sessions, session] };
      return session;
    },
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/coaching")) return web.fetch(input, init);
    if (web.signedInAs(request.headers) !== email) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/api/coaching" && request.method === "GET") {
      route.reads++;
      return json(route.coaching);
    }
    if (url.pathname === "/api/coaching/order" && request.method === "GET") {
      const coach = route.coaching.coaches.find((each) => each.id === url.searchParams.get("coach"));
      if (!coach || !route.coaching.price) return json({ error: "not_orderable" }, 404);
      const order: CoachingOrderResponse = { coach: { id: coach.id, name: coach.name }, price: { amount: route.coaching.price.amount, currency: route.coaching.price.currency }, cgv: route.cgv };
      return json(order);
    }
    if (url.pathname === "/api/coaching/order" && request.method === "POST") {
      const body = (await request.json()) as Body;
      route.orders.push(body);
      if (route.cgv && body.cgv !== route.cgv.version) return json({ error: "cgv_required" }, 400);
      if (route.checkout.status !== 200) return json({ error: "failed" }, route.checkout.status);
      return json({ url: CHECKOUT_URL });
    }
    const editing = /^\/api\/coaching\/sessions\/([^/]+)$/.exec(url.pathname);
    if (editing && request.method === "PATCH") {
      const id = decodeURIComponent(editing[1]!);
      const body = (await request.json()) as Body;
      route.edits.push({ id, body });
      const errors = refusals(body);
      if (errors.length > 0) return json({ errors }, 400);
      route.coaching = {
        ...route.coaching,
        sessions: route.coaching.sessions.map((session) =>
          session.id === id
            ? {
                ...session,
                scheduledAt: fromParis(body.scheduledAt as string),
                durationMinutes: (body.durationMinutes as number | null) ?? null,
                videoLink: (body.videoLink as string) || null,
                note: (body.note as string) || null,
                changedBy: "candidate",
              }
            : session,
        ),
      };
      return json({ id });
    }
    return json({ error: "not_found" }, 404);
  });
  return route;
}
