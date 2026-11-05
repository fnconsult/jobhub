// The web app's `GET /api/agenda` for the e2e tests (#693): the signed-in Candidate's Agenda (AgendaResponse,
// @jobhub/shared/reads), answered only to a request carrying their session cookie, 401 to any other, as
// apps/web/src/app/api/agenda/route.ts answers. Every other request goes on to the fake web app's session endpoints.
import type { AgendaResponse } from "@jobhub/shared/reads";
import type { fakeWebApp } from "../src/session/testing";

/** The Agenda the web app holds for the signed-in Candidate, around Tuesday 20 October 2026: its upcoming items. */
export const AGENDA: AgendaResponse = {
  toSchedule: [{ id: "s0", coach: { id: "coach-2", name: "Paul Durand", bookingUrl: "https://cal.com/paul-durand" }, paidAt: "2026-10-18T08:00:00.000Z", reschedules: [] }],
  days: [
    {
      day: "2026-10-21",
      items: [
        { kind: "interview", id: "i1", applicationId: "a1", jobTitle: "Responsable qualité", employer: "Aéroline", scheduledAt: "2026-10-21T10:00:00.000Z", durationMinutes: 45, format: "video", place: "Teams : https://teams.microsoft.com/l/meetup-join/exemple", note: null, cancelledAt: null, reschedules: [] },
        { kind: "interview", id: "i2", applicationId: "a1", jobTitle: "Responsable qualité", employer: "Aéroline", scheduledAt: "2026-10-21T13:00:00.000Z", durationMinutes: null, format: "on_site", place: "12 rue de la Paix, Paris", note: null, cancelledAt: "2026-10-19T08:00:00.000Z", reschedules: [] },
      ],
    },
    {
      day: "2026-10-23",
      items: [{ kind: "coachingSession", id: "s1", coach: { id: "coach-1", name: "Claire Martin" }, scheduledAt: "2026-10-23T09:00:00.000Z", durationMinutes: 60, videoLink: "https://meet.google.com/exemple", note: null, changedBy: "coach", reschedules: [] }],
    },
  ],
};

/**
 * Serves `GET /api/agenda` at the network (the global fetch the app's API calls go through): `agenda` to `email`'s
 * session, or `status` when a test makes the web app fail; `asked` keeps whose session each request carried. Undone by
 * `jest.restoreAllMocks()`.
 */
export function serveAgenda(web: ReturnType<typeof fakeWebApp>, email: string) {
  const route = { agenda: AGENDA, status: 200, asked: [] as (string | null)[] };
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname !== "/api/agenda") return web.fetch(input, init);
    const signedInAs = web.signedInAs(request.headers);
    route.asked.push(signedInAs);
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (signedInAs !== email) return json({ error: "unauthorized" }, 401);
    if (route.status !== 200) return json({ error: "internal" }, route.status);
    return json(route.agenda, 200);
  });
  return route;
}
