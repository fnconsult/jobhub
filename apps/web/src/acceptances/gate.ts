/**
 * What a Candidate reaches while a CGU version waits for their Acceptance (ADR-0062): the Acceptance screen, their
 * Data export and Account deletion (Mes données), their subscription (to withdraw or cancel, #511, #513), the Legal
 * Texts and sign-in. Every other page of theirs sends them to the Acceptance screen, to come back afterwards.
 */
import { RETURN_PARAM, safeReturnPath } from "../auth/sign-in-return";
import { splitLocalePrefix } from "../i18n/locale-header";
import { routes } from "../routes";

const OPEN = [routes.acceptance, routes.accountData, routes.subscription, routes.accountDeleted, "/legal", routes.signIn];

/** Whether `path` (with its query, under `/en` too, #545) stays open to a Candidate who has a CGU version to accept. */
export function openWhilePending(path: string): boolean {
  const { pathname } = splitLocalePrefix(pathnameOf(path));
  return OPEN.some((open) => pathname === open || pathname.startsWith(`${open}/`));
}

/** The Acceptance screen, bringing the Candidate back to `back` (a page of this site) once they accept. */
export function acceptanceHref(back: string | null): string {
  const path = safeReturnPath(back);
  return path && path !== routes.home ? `${routes.acceptance}?${new URLSearchParams({ [RETURN_PARAM]: path })}` : routes.acceptance;
}

/** Where to go once accepted: `raw` when it is a page of this site other than the Acceptance screen, else home. */
export function acceptanceReturn(raw: string | null | undefined): string {
  const path = safeReturnPath(raw);
  return path && pathnameOf(path) !== routes.acceptance ? path : routes.home;
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0]!;
}
