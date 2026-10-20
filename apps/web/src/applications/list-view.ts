import { APPLICATION_STATUSES, FINAL_APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import type { ApplicationSummary } from "./index";

/** The columns the Applications list sorts by; without one it shows the latest saved first. */
export const APPLICATION_SORTS = ["offre", "profil", "entretiens", "statut"] as const;
export type ApplicationSort = (typeof APPLICATION_SORTS)[number];
export type SortOrder = "asc" | "desc";

/** How the Candidate filters and sorts their Applications, as the page's address carries it. */
export interface ApplicationListView {
  profileId: string | null;
  status: ApplicationStatus | null;
  showArchived: boolean;
  sort: ApplicationSort | null;
  order: SortOrder;
}

/** The address's search parameters (French, like the interface default). */
export type ApplicationListParams = { profil?: string; statut?: string; archivees?: string; tri?: string; ordre?: string };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads the view from the address; anything it does not know is left at its default. */
export function applicationListView(params: { [K in keyof ApplicationListParams]?: string | string[] }): ApplicationListView {
  const status = one(params.statut);
  const sort = one(params.tri);
  return {
    profileId: one(params.profil) || null,
    status: APPLICATION_STATUSES.includes(status as ApplicationStatus) ? (status as ApplicationStatus) : null,
    showArchived: one(params.archivees) === "1",
    sort: APPLICATION_SORTS.includes(sort as ApplicationSort) ? (sort as ApplicationSort) : null,
    order: one(params.ordre) === "desc" ? "desc" : "asc",
  };
}

/**
 * An Archived Application: at an end state (Acceptée, Refusée, Abandonnée), or
 * on an archived Profile. Hidden from the list unless the Candidate asks for them.
 */
export function isArchivedApplication(application: ApplicationSummary): boolean {
  return (FINAL_APPLICATION_STATUSES as readonly ApplicationStatus[]).includes(application.status) || application.profile.archived;
}

/** The next interview still to come, or null. */
function nextInterview(application: ApplicationSummary, now: Date): number | null {
  const upcoming = application.interviews.map((interview) => interview.scheduledAt.getTime()).filter((at) => at >= now.getTime());
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

/**
 * The Applications the view shows, in its order. Filtering by an end state shows
 * those Applications even with the archived ones hidden: that is what was asked for.
 * Ties, and Applications with no interview to come, keep the latest saved first.
 */
export function viewApplications(applications: ReadonlyArray<ApplicationSummary>, view: ApplicationListView, locale: string, now = new Date()): ApplicationSummary[] {
  const finalStatusAsked = view.status !== null && (FINAL_APPLICATION_STATUSES as readonly ApplicationStatus[]).includes(view.status);
  const shown = applications.filter(
    (application) =>
      (view.profileId === null || application.profile.id === view.profileId) &&
      (view.status === null || application.status === view.status) &&
      (view.showArchived || finalStatusAsked || !isArchivedApplication(application)),
  );
  const latestFirst = (a: ApplicationSummary, b: ApplicationSummary) => b.createdAt.getTime() - a.createdAt.getTime();
  if (view.sort === null) return shown.sort(latestFirst);
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const sign = view.order === "desc" ? -1 : 1;
  const compare = (a: ApplicationSummary, b: ApplicationSummary): number => {
    switch (view.sort) {
      case "offre":
        return sign * collator.compare(a.jobOffer.title, b.jobOffer.title);
      case "profil":
        return sign * collator.compare(a.profile.name, b.profile.name);
      case "statut":
        return sign * (APPLICATION_STATUSES.indexOf(a.status) - APPLICATION_STATUSES.indexOf(b.status));
      case "entretiens": {
        const [x, y] = [nextInterview(a, now), nextInterview(b, now)];
        // Applications with no interview to come go last, whichever the order.
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        return sign * (x - y);
      }
      default:
        return 0;
    }
  };
  return shown.sort((a, b) => compare(a, b) || latestFirst(a, b));
}

/** The address of the view with `changes` applied; defaults are left out. */
export function applicationListHref(base: string, view: ApplicationListView, changes: Partial<ApplicationListView> & { board?: boolean } = {}): string {
  const next = { ...view, ...changes };
  const params = new URLSearchParams();
  if (changes.board) params.set("vue", "tableau");
  if (next.profileId) params.set("profil", next.profileId);
  if (next.status) params.set("statut", next.status);
  if (next.showArchived) params.set("archivees", "1");
  if (next.sort) {
    params.set("tri", next.sort);
    if (next.order === "desc") params.set("ordre", "desc");
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
