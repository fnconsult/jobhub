/**
 * The route pattern of a page's address (#344, #1139): what may be kept or shown of where something happened, never an
 * id. Depends on nothing, so a page, a route or a module can import it without pulling in the database.
 */

/** Longest path a pattern is taken of: Jobbbox's pages have far fewer segments. */
const MAX_SEGMENTS = 8;

/**
 * The route pattern of a page's address: its path without query or fragment, each segment that is not a fixed word
 * of lower-case letters and hyphens (an id, whatever its shape) as `placeholder` (`[id]`, or `:id` as Signalement
 * triage reads it: `/candidatures/:id/documents`). Null for something that is not a path.
 */
export function routePattern(address: string | null | undefined, placeholder = "[id]"): string | null {
  if (!address?.startsWith("/")) return null;
  const segments = address.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (segments.length > MAX_SEGMENTS) return null;
  return `/${segments.map((segment) => (/^[a-z]+(?:-[a-z]+)*$/.test(segment) ? segment : placeholder)).join("/")}`;
}
