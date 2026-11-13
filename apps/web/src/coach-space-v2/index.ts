/**
 * « Espace coach v2 » (#867, ADR-0107): the one Platform Setting the Human Coach epic is built behind, off by default.
 * Off, every page, route, e-mail, notification and app read behaves as before the epic; on, the new Coach workspace and
 * marketplace. #888 turns it on, then retires the old Coach space. The legal, provider and fiscal gates still apply
 * once it is on: this switch never approves them.
 */
export const COACH_SPACE_V2 = "COACH_SPACE_V2";

/** Whether a resolved settings snapshot has it on: only the exact value "true" does. */
export function coachSpaceV2In(snapshot: { setting(name: string): { value: string } | undefined }): boolean {
  return snapshot.setting(COACH_SPACE_V2)?.value === "true";
}

/** The same rule on an env-like record (the worker's resolved settings). */
export const coachSpaceV2InEnv = (env: Record<string, string | undefined>): boolean => env[COACH_SPACE_V2] === "true";
