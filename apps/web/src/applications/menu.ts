import { matchScoreReliability, type ApplicationStatus, type MatchScore } from "@jobhub/shared";
import type { FollowUpNotice } from "../follow-ups";
import { routes } from "../routes";
import { unfoldMenu, type UnfoldedMenu } from "../sidebar-menus";
import type { ApplicationSummary } from "./index";
import { isArchivedApplication } from "./list-view";

/**
 * One Application on Mes candidatures' card: its Job Offer, its status, its Match Score (null when it is not
 * computable) and what waits for the Candidate there (à traiter: a Follow-up or an « Abandonnée » suggestion), if anything.
 */
export interface ApplicationsMenuRow {
  id: string;
  title: string;
  employer: string | null;
  status: ApplicationStatus;
  matchScore: number | null;
  toHandle: FollowUpNotice["kind"] | null;
}

/** Mes candidatures (ADR-0070, #604): its card in the menu's conversation, and what it unfolds into in the Sidebar. */
export interface ApplicationsMenu {
  /** Latest saved first; Archived Applications only when asked for. */
  rows: ApplicationsMenuRow[];
  /** How many of the rows are à traiter. */
  toHandle: number;
  /** Archived Applications left out of the rows. */
  archivedHidden: number;
  /** The Sidebar's objects: never the Archived Applications. */
  sidebar: UnfoldedMenu;
}

/**
 * Mes candidatures from the Candidate's `applications` (latest saved first, as the Applications module lists them), the
 * Follow-up `notices` waiting for them, and each Application's Match Score. `showArchived`: the card lists the Archived
 * Applications too.
 */
export function applicationsMenu({
  applications,
  notices,
  matchScores,
  showArchived = false,
}: {
  applications: readonly ApplicationSummary[];
  notices: readonly FollowUpNotice[];
  matchScores: ReadonlyMap<string, MatchScore>;
  showArchived?: boolean;
}): ApplicationsMenu {
  const waiting = new Map(notices.map((notice) => [notice.applicationId, notice.kind]));
  const current = applications.filter((application) => !isArchivedApplication(application));
  const listed = showArchived ? applications : current;
  const rows = listed.map((application): ApplicationsMenuRow => {
    const matchScore = matchScores.get(application.id);
    return {
      id: application.id,
      title: application.jobOffer.title,
      employer: application.jobOffer.employer ?? null,
      status: application.status,
      matchScore: matchScore && matchScoreReliability(matchScore) !== "not_computable" ? matchScore.score : null,
      toHandle: waiting.get(application.id) ?? null,
    };
  });
  return {
    rows,
    toHandle: rows.filter((row) => row.toHandle !== null).length,
    archivedHidden: applications.length - listed.length,
    sidebar: unfoldMenu(
      current.map((application) => ({
        id: application.id,
        label: [application.jobOffer.employer, application.jobOffer.title].filter(Boolean).join(" · "),
        href: routes.application(application.id),
        toHandle: waiting.has(application.id),
      })),
    ),
  };
}
