import type { getServerT } from "@/i18n/server";

/**
 * « · se fait appeler Mimi » (#922): beside the Candidate's name, wherever a Human Coach reads it, the Preferred Name
 * the coaches call them by, when it differs from their Given Name (`nameForCoach`); nothing otherwise.
 */
export function CalledBy({ name, t }: { name: string | null; t: Awaited<ReturnType<typeof getServerT>> }) {
  return name ? <span className="called-by">{` · ${t("coachSpace.calledBy", { name })}`}</span> : null;
}
