// The web app's Mes candidatures routes for the e2e tests (#691), as apps/web/src/app/api/applications answers them,
// only to a request carrying the signed-in Candidate's session cookie (401 otherwise) and, for a write, the app's
// origin (403 otherwise): the card (`GET /api/applications`, `?archivees=1` for the Archived Applications too), one
// Application (`GET /api/applications/:id`), its status (`PATCH /api/applications/:id`), and its Interviews: added
// (`POST …/interviews`, only at « Entretien »), changed or Rescheduled (`PATCH …/interviews/:id`), Cancelled
// (`POST …/interviews/:id/cancel`) or removed (`DELETE …/interviews/:id`), each checked as the web's Applications module
// checks it. Every other request goes on to `rest`: the coach's fake, then the fake web app's session endpoints.
import { APP_ORIGIN, APPLICATION_STATUSES, FINAL_APPLICATION_STATUSES, INTERVIEW_FORMATS, type ApplicationStatus } from "@jobhub/shared";
import { applicationResponseSchema, applicationsResponseSchema, type ApplicationResponse, type ApplicationsResponse, type InterviewRead } from "@jobhub/shared/reads";
import type { fakeWebApp } from "../src/session/testing";

/** A body as the app sent it. */
type Body = Record<string, unknown>;
type FieldError = { field: string; code: string };

/** `scheduledAt` as the web reads it: French time without an offset, "2026-11-12T14:30". */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-11-12T14:30" in French time (winter: UTC+1, summer: UTC+2). */
export function fromParis(wallClock: string): string {
  const asUtc = new Date(`${wallClock}:00.000Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(asUtc).find((part) => part.type === "timeZoneName")!.value;
  const hours = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 0);
  return new Date(asUtc.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** The web's interviewFields: what it refuses of the fields `body` names (all of them when `adding`). */
function refusals(body: Body, adding: boolean): FieldError[] {
  const errors: FieldError[] = [];
  if (adding || "scheduledAt" in body) {
    const at = typeof body.scheduledAt === "string" ? body.scheduledAt.trim() : "";
    const parts = WALL_CLOCK.exec(at);
    if (!at) errors.push({ field: "scheduledAt", code: "required" });
    else if (!parts || Number(parts[2]) > 12 || Number(parts[3]) > 31 || Number(parts[4]) > 23 || Number(parts[5]) > 59) errors.push({ field: "scheduledAt", code: "invalid" });
  }
  const duration = body.durationMinutes;
  if (duration !== undefined && duration !== null && duration !== "" && (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 1440))
    errors.push({ field: "durationMinutes", code: "invalid" });
  const format = body.format;
  if (format !== undefined && format !== null && format !== "" && !(INTERVIEW_FORMATS as readonly unknown[]).includes(format)) errors.push({ field: "format", code: "invalid" });
  for (const field of ["place", "note"] as const) {
    const value = body[field];
    if (value !== undefined && (typeof value !== "string" || value.trim().length > 500)) errors.push({ field, code: "too_long" });
  }
  return errors;
}

const blank = (value: unknown) => value === undefined || value === null || value === "";

/** One of the Candidate's Applications on the web app: its read, whether its Profile is archived, what waits there. */
export interface HeldApplication {
  application: ApplicationResponse;
  profileArchived?: boolean;
  toHandle?: "follow_up" | "abandon_suggestion" | null;
}

/** An Archived Application: at an end state, or on an archived Profile (apps/web/src/applications/list-view.ts). */
const isArchived = ({ application, profileArchived }: HeldApplication) => (FINAL_APPLICATION_STATUSES as readonly ApplicationStatus[]).includes(application.status) || profileArchived === true;

/** What a test reads and changes of the web app's Applications. */
export interface ApplicationsRoute {
  held: HeldApplication[];
  /** Every write the app sent: its method, path and body. */
  writes: { method: string; path: string; body: Body | undefined }[];
  /** The next write is answered with this status instead (a server failing, 500). */
  failNextWrite: number | null;
  /** The Application `id` as the web app holds it now. */
  application(id: string): ApplicationResponse;
}

/**
 * Serves Mes candidatures at the network (the global fetch the app's API calls go through), to `email`'s session, the
 * Applications `held`; any other request to `rest`. Undone by `jest.restoreAllMocks()`.
 */
export function serveApplications(web: ReturnType<typeof fakeWebApp>, email: string, held: HeldApplication[], rest: typeof globalThis.fetch = web.fetch) {
  const route: ApplicationsRoute = {
    held: held.map((each) => ({ ...each, application: applicationResponseSchema.parse(structuredClone(each.application)) })),
    writes: [],
    failNextWrite: null,
    application: (id) => route.held.find((each) => each.application.id === id)!.application,
  };
  let next = 0;
  const now = () => new Date().toISOString();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const notFound = () => json({ error: "not_found" }, 404);
  const change = (id: string, changed: (application: ApplicationResponse) => ApplicationResponse) => {
    route.held = route.held.map((each) => (each.application.id === id ? { ...each, application: applicationResponseSchema.parse(changed(each.application)) } : each));
    return json({ id });
  };
  const changeInterview = (id: string, interviewId: string, changed: (interview: InterviewRead) => InterviewRead | null) =>
    change(id, (application) => ({ ...application, interviews: application.interviews.flatMap((interview) => (interview.id === interviewId ? (changed(interview) ?? []) : [interview])) }));

  function card(showArchived: boolean): ApplicationsResponse {
    const shown = route.held.filter((each) => showArchived || !isArchived(each));
    return applicationsResponseSchema.parse({
      applications: shown.map(({ application, profileArchived, toHandle }) => ({
        id: application.id,
        title: application.jobOffer.title,
        employer: application.jobOffer.employer,
        status: application.status,
        matchScore: application.matchScore,
        toHandle: toHandle ?? null,
        nextDeadline: null,
        expired: application.jobOffer.expiredAt !== null || application.reportedUnavailableAt !== null,
        reportedByYou: application.reportedUnavailableAt !== null,
        archived: profileArchived === true,
      })),
      toHandle: shown.filter((each) => each.toHandle).length,
      archivedHidden: showArchived ? 0 : route.held.filter(isArchived).length,
    });
  }

  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/applications")) return rest(input, init);
    // Its Tailored Documents are the fake web app's (#695).
    if (url.pathname.endsWith("/documents")) return web.fetch(input, init);
    if (web.signedInAs(request.headers) !== email) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/api/applications" && request.method === "GET") return json(card(url.searchParams.get("archivees") === "1"));
    const [, id, interviews, interviewId, cancel] = /^\/api\/applications\/([^/]+)(?:\/(interviews)(?:\/([^/]+)(?:\/(cancel))?)?)?$/.exec(url.pathname) ?? [];
    const found = id ? route.held.find((each) => each.application.id === decodeURIComponent(id)) : undefined;
    if (request.method === "GET") return found && !interviews ? json(found.application) : notFound();

    if (request.headers.get("origin") !== APP_ORIGIN) return json({ error: "forbidden" }, 403);
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Body) : undefined;
    route.writes.push({ method: request.method, path: url.pathname, body });
    if (route.failNextWrite !== null) {
      const status = route.failNextWrite;
      route.failNextWrite = null;
      return json({ error: "internal_error" }, status);
    }
    if (!found) return notFound();
    const application = found.application;

    if (!interviews && request.method === "PATCH") {
      if (!(APPLICATION_STATUSES as readonly unknown[]).includes(body?.status)) return json({ errors: [{ field: "status", code: "invalid" }] }, 400);
      return change(application.id, (current) => ({ ...current, status: body!.status as ApplicationStatus, statusChangedAt: now() }));
    }
    if (interviews && !interviewId && request.method === "POST") {
      const errors = refusals(body ?? {}, true);
      if (errors.length > 0) return json({ errors }, 400);
      if (application.status !== "interview" && body?.moveToInterview !== true) return json({ error: "not_in_interview" }, 409);
      const added: InterviewRead = {
        id: `interview-${++next}`,
        scheduledAt: fromParis(String(body!.scheduledAt).trim()),
        durationMinutes: blank(body!.durationMinutes) ? null : (body!.durationMinutes as number),
        format: blank(body!.format) ? null : (body!.format as InterviewRead["format"]),
        place: String(body!.place ?? "").trim(),
        note: String(body!.note ?? "").trim(),
        cancelledAt: null,
        reschedules: [],
      };
      return change(application.id, (current) => ({ ...current, status: "interview", interviews: [...current.interviews, added] }));
    }
    const interview = application.interviews.find((each) => each.id === decodeURIComponent(interviewId ?? ""));
    if (!interview) return notFound();
    if (cancel && request.method === "POST") return changeInterview(application.id, interview.id, (current) => ({ ...current, cancelledAt: current.cancelledAt ?? now() }));
    if (!cancel && request.method === "DELETE") return changeInterview(application.id, interview.id, () => null);
    if (!cancel && request.method === "PATCH") {
      const errors = refusals(body ?? {}, false);
      if (errors.length > 0) return json({ errors }, 400);
      return changeInterview(application.id, interview.id, (current) => {
        const scheduledAt = typeof body!.scheduledAt === "string" ? fromParis(body!.scheduledAt.trim()) : current.scheduledAt;
        const moved = scheduledAt !== current.scheduledAt;
        return {
          ...current,
          scheduledAt,
          ...("durationMinutes" in body! ? { durationMinutes: blank(body!.durationMinutes) ? null : (body!.durationMinutes as number) } : {}),
          ...("format" in body! ? { format: blank(body!.format) ? null : (body!.format as InterviewRead["format"]) } : {}),
          ...("place" in body! ? { place: String(body!.place).trim() } : {}),
          ...("note" in body! ? { note: String(body!.note).trim() } : {}),
          // A new date is a Reschedule, kept in its history (ADR-0027).
          reschedules: moved ? [...current.reschedules, { previousAt: current.scheduledAt, newAt: scheduledAt, by: "candidate" as const, at: now() }] : current.reschedules,
        };
      });
    }
    return notFound();
  });
  return route;
}
