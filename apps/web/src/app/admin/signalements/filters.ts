import { isSignalementStatus, isSignalementType, SIGNALEMENT_STATUSES, TO_HANDLE_STATUSES, type SignalementStatus, type SignalementType } from "../../../signalements/values";

/** The status filter as the URL holds it (`statut`): absent for « à traiter », a status, or « tous ». */
export const ALL_STATUSES = "tous" as const;
export type StatusFilter = SignalementStatus | typeof ALL_STATUSES | undefined;

/** The Signalements page's filters, read from its untrusted URL: a type or all; « à traiter » unless a status or « tous » is asked. */
export function signalementsFilter(query: { type?: string; statut?: string }): { type?: SignalementType; status: StatusFilter; statuses: readonly SignalementStatus[] } {
  const type = isSignalementType(query.type) ? query.type : undefined;
  const status: StatusFilter = isSignalementStatus(query.statut) || query.statut === ALL_STATUSES ? query.statut : undefined;
  const statuses = status === undefined ? TO_HANDLE_STATUSES : status === ALL_STATUSES ? SIGNALEMENT_STATUSES : [status];
  return { ...(type ? { type } : {}), status, statuses };
}
