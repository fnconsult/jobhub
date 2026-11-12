/**
 * The Extension Events in the Back Office (#925): Activité › Extension lists them, the Dashboard's Extension card counts
 * them. One deep module in front of #924's `extension_event` table, read-only:
 *
 *   const office = createExtensionEventsBackOffice(database);
 *   await office.list(query);    // Activité › Extension, newest first, at most LIST_LIMIT (`query` untrusted: the page's address)
 *   await office.dashboard();    // the Extension card: the last DASHBOARD_DAYS days, Paris time
 *
 * The card is built by `extensionDashboard(counts, today)`, a pure function of the day's counts the database sums, so
 * what it shows is tested on known data. A Candidate is named by their email; a Guest by nothing (« Invité »): their
 * rows hold no identifier of any kind.
 */
import { readExtensionVersion } from "@jobhub/shared";
import * as z from "zod";
import type { Queryable } from "../database/pool";
import { EXTENSION_EVENT_KINDS, type ErrorPlace, type EventObject, type EventObjectType, type ExtensionEventKind } from "./index";

/** How many Extension Events Activité › Extension shows at most, the newest. */
export const LIST_LIMIT = 200;
/** The days the Dashboard's Extension card covers, today the last. */
export const DASHBOARD_DAYS = 30;
/** How many domains the card names, those with the most « page cannot be captured » errors. */
export const TOP_DOMAINS = 5;
/** The Extension error code of a page that cannot be captured (CONTEXT.md). */
export const CAPTURE_IMPOSSIBLE = "captureImpossible";

/** Who did it: a signed-in Candidate, or a Guest (« Invité »). */
export const EXTENSION_EVENT_WHO = ["candidate", "guest"] as const;
export type ExtensionEventWho = (typeof EXTENSION_EVENT_WHO)[number];

const TIME_ZONE = "Europe/Paris";

export interface ExtensionEventsFilter {
  kind?: ExtensionEventKind;
  who?: ExtensionEventWho;
  /** One Candidate's id: their Extension Events alone (a Guest's filter then no longer applies). */
  candidate?: string;
  version?: string;
  /** A page's domain: its own Extension Events and its subdomains'. */
  domain?: string;
}

/** Each field on its own: one that cannot be read is dropped, the others still filter. The page's address: `type`, `qui`, `candidat`, `version`, `domaine`. */
const filterSchema = z.object({
  type: z.enum(EXTENSION_EVENT_KINDS).optional().catch(undefined),
  qui: z.enum(EXTENSION_EVENT_WHO).optional().catch(undefined),
  candidat: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional()
    .catch(undefined),
  version: z
    .string()
    .transform((version, context) => readExtensionVersion(version) ?? (context.addIssue({ code: "custom", message: "not a version" }), z.NEVER))
    .optional()
    .catch(undefined),
  domaine: z
    .string()
    .transform((domain) => domain.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/))
    .optional()
    .catch(undefined),
});

/** The filter of the page's address (untrusted), every field it cannot read left out. */
export function extensionEventsFilter(input: unknown): ExtensionEventsFilter {
  const parsed = filterSchema.safeParse(typeof input === "object" && input !== null ? input : {});
  if (!parsed.success) return {};
  const { type, qui, candidat, version, domaine } = parsed.data;
  return {
    ...(type ? { kind: type } : {}),
    ...(qui && !candidat ? { who: qui } : {}),
    ...(candidat ? { candidate: candidat } : {}),
    ...(version ? { version } : {}),
    ...(domaine ? { domain: domaine } : {}),
  };
}

/** One row of Activité › Extension. */
export interface ListedExtensionEvent {
  id: string;
  at: Date;
  kind: ExtensionEventKind;
  /** Null: a Guest (« Invité »). */
  candidate: { id: string; email: string } | null;
  extensionVersion: string | null;
  object: EventObject | null;
  error: {
    code: string;
    messageKey: string | null;
    route: string | null;
    httpStatus: number | null;
    place: ErrorPlace | null;
    browser: string | null;
    pageDomain: string | null;
  } | null;
}

/** How many Extension Events of one kind a day held, by one Candidate (null: Guests) on one version, for one error code and domain. */
export interface ExtensionEventCount {
  /** "2026-11-10", Paris time. */
  day: string;
  kind: ExtensionEventKind;
  candidateId: string | null;
  extensionVersion: string | null;
  /** An error's; null for an action. */
  errorCode: string | null;
  /** An error's; null for an action. */
  pageDomain: string | null;
  events: number;
}

/** What the extension did on one day. */
export interface ExtensionDashboardDay {
  day: string;
  captures: { candidate: number; guest: number };
  matchScores: number;
  /** Applications created from the extension. */
  applications: number;
  /** The distinct Candidates who did anything from the extension, an error included. */
  activeCandidates: number;
  /** The Extension Versions the day's Extension Events stated, the newest first. */
  versions: string[];
  errors: number;
}

/** The Dashboard's Extension card (#925). */
export interface ExtensionDashboard {
  /** Every day of the DASHBOARD_DAYS, the oldest first, today the last. */
  days: ExtensionDashboardDay[];
  /** The days summed; each active Candidate counted once. */
  totals: Omit<ExtensionDashboardDay, "day" | "versions">;
  /** The Extension Versions in service, the newest first, with their Extension Events; null: stated by none, last. */
  versions: { version: string | null; events: number }[];
  /** The TOP_DOMAINS domains with the most « page cannot be captured » errors, by name on a tie. */
  captureImpossibleDomains: { domain: string; errors: number }[];
}

/** `day` ("2026-11-10") moved by `offset` days. */
function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Newest first: part by part, as numbers ("0.10.0" after "0.9.0"). */
function newestFirst(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < Math.max(left!.length, right!.length); index++) {
    const difference = (right![index] ?? 0) - (left![index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The Extension card of the DASHBOARD_DAYS days up to `today` ("2026-11-10", Paris), from the days' counts; counts outside them are left out. */
export function extensionDashboard(counts: readonly ExtensionEventCount[], today: string): ExtensionDashboard {
  const first = shiftDay(today, 1 - DASHBOARD_DAYS);
  const inWindow = counts.filter((count) => count.day >= first && count.day <= today);
  const sum = (rows: readonly ExtensionEventCount[], kind: ExtensionEventKind) => rows.filter((row) => row.kind === kind).reduce((total, row) => total + row.events, 0);
  const figures = (rows: readonly ExtensionEventCount[]) => ({
    captures: { candidate: sum(rows.filter((row) => row.candidateId !== null), "capture"), guest: sum(rows.filter((row) => row.candidateId === null), "capture") },
    matchScores: sum(rows, "match_score"),
    applications: sum(rows, "application_created"),
    activeCandidates: new Set(rows.flatMap((row) => (row.candidateId === null ? [] : [row.candidateId]))).size,
    errors: sum(rows, "error"),
  });

  const days = Array.from({ length: DASHBOARD_DAYS }, (_, index): ExtensionDashboardDay => {
    const day = shiftDay(first, index);
    const rows = inWindow.filter((row) => row.day === day);
    const versions = [...new Set(rows.flatMap((row) => (row.extensionVersion === null ? [] : [row.extensionVersion])))].sort(newestFirst);
    return { day, ...figures(rows), versions };
  });

  const byVersion = new Map<string | null, number>();
  for (const row of inWindow) byVersion.set(row.extensionVersion, (byVersion.get(row.extensionVersion) ?? 0) + row.events);
  const versions = [...byVersion]
    .map(([version, events]) => ({ version, events }))
    .sort((a, b) => (a.version === null ? 1 : b.version === null ? -1 : newestFirst(a.version, b.version)));

  const byDomain = new Map<string, number>();
  for (const row of inWindow) if (row.kind === "error" && row.errorCode === CAPTURE_IMPOSSIBLE && row.pageDomain) byDomain.set(row.pageDomain, (byDomain.get(row.pageDomain) ?? 0) + row.events);
  const captureImpossibleDomains = [...byDomain]
    .map(([domain, errors]) => ({ domain, errors }))
    .sort((a, b) => b.errors - a.errors || a.domain.localeCompare(b.domain))
    .slice(0, TOP_DOMAINS);

  return { days, totals: figures(inWindow), versions, captureImpossibleDomains };
}

export interface ExtensionEventsBackOffice {
  /** The newest Extension Events first, at most LIST_LIMIT. `query` is untrusted (the page's address): `{ type?, qui?, candidat?, version?, domaine? }`. */
  list(query?: unknown): Promise<ListedExtensionEvent[]>;
  /** The Dashboard's Extension card, today (Paris) the last of its days. */
  dashboard(): Promise<ExtensionDashboard>;
}

interface ListedRow {
  id: string;
  at: Date;
  kind: ExtensionEventKind;
  candidate_id: string | null;
  email: string | null;
  extension_version: string | null;
  object_type: EventObjectType | null;
  object_id: string | null;
  error_code: string | null;
  message_key: string | null;
  route: string | null;
  http_status: number | null;
  place: ErrorPlace | null;
  browser: string | null;
  page_domain: string | null;
}

const listed = (row: ListedRow): ListedExtensionEvent => ({
  id: row.id,
  at: row.at,
  kind: row.kind,
  candidate: row.candidate_id ? { id: row.candidate_id, email: row.email ?? "" } : null,
  extensionVersion: row.extension_version,
  object: row.object_type && row.object_id ? { type: row.object_type, id: row.object_id } : null,
  error:
    row.kind === "error"
      ? { code: row.error_code ?? "", messageKey: row.message_key, route: row.route, httpStatus: row.http_status, place: row.place, browser: row.browser, pageDomain: row.page_domain }
      : null,
});

export function createExtensionEventsBackOffice(database: Queryable, { now = () => new Date() }: { now?: () => Date } = {}): ExtensionEventsBackOffice {
  return {
    async list(query) {
      const filter = extensionEventsFilter(query);
      const conditions: string[] = [];
      const params: unknown[] = [];
      const where = (condition: (param: string) => string, value: unknown) => {
        params.push(value);
        conditions.push(condition(`$${params.length}`));
      };
      if (filter.kind) where((param) => `e.kind = ${param}`, filter.kind);
      if (filter.who === "guest") conditions.push("e.candidate_id IS NULL");
      if (filter.who === "candidate") conditions.push("e.candidate_id IS NOT NULL");
      if (filter.candidate) where((param) => `e.candidate_id = ${param}`, filter.candidate);
      if (filter.version) where((param) => `e.extension_version = ${param}`, filter.version);
      if (filter.domain) where((param) => `(e.page_domain = ${param} OR right(e.page_domain, length(${param}) + 1) = '.' || ${param})`, filter.domain);
      params.push(LIST_LIMIT);
      const { rows } = await database.query<ListedRow>(
        `SELECT e.id::text AS id, e.at, e.kind, e.candidate_id, c.email, e.extension_version, e.object_type, e.object_id, e.error_code, e.message_key,
                e.route, e.http_status, e.place, e.browser, e.page_domain
           FROM extension_event e LEFT JOIN candidate c ON c.id = e.candidate_id
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY e.at DESC, e.id DESC LIMIT $${params.length}`,
        params,
      );
      return rows.map(listed);
    },

    async dashboard() {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
      const { rows } = await database.query<{ day: string; kind: ExtensionEventKind; candidate_id: string | null; extension_version: string | null; error_code: string | null; page_domain: string | null; events: number }>(
        `SELECT to_char(at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS day, kind, candidate_id, extension_version, error_code, page_domain, count(*)::int AS events
           FROM extension_event
          WHERE at >= ($1::date - ($2::int - 1))::timestamp AT TIME ZONE '${TIME_ZONE}'
            AND at < ($1::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'
          GROUP BY 1, 2, 3, 4, 5, 6`,
        [today, DASHBOARD_DAYS],
      );
      return extensionDashboard(
        rows.map((row) => ({ day: row.day, kind: row.kind, candidateId: row.candidate_id, extensionVersion: row.extension_version, errorCode: row.error_code, pageDomain: row.page_domain, events: row.events })),
        today,
      );
    },
  };
}
