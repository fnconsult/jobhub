/**
 * What the Locations input (#235) does with a place the Candidate chose or typed, and with the
 * arrow keys in its suggestions: the rules, apart from the markup.
 *
 *   addPlace(places, "Lyon (69)")     the places with it added, or why it is refused
 *   movedOption(active, count, "down") the suggestion the arrow moves to
 */
import { locationKey, MAX_SEARCH_LOCATIONS } from "@jobhub/shared";

/** Why a place is not added: already there (without case or accents), MAX_SEARCH_LOCATIONS reached, or nothing typed. */
export type PlaceRefusal = "duplicate" | "full" | "blank";

/** `places` with `place` added after them, trimmed; or why it cannot be. */
export function addPlace(places: readonly string[], place: string): { places: string[] } | { refused: PlaceRefusal } {
  const added = place.trim();
  if (!added) return { refused: "blank" };
  if (places.some((each) => locationKey(each) === locationKey(added))) return { refused: "duplicate" };
  if (places.length >= MAX_SEARCH_LOCATIONS) return { refused: "full" };
  return { places: [...places, added] };
}

/** The suggestion an arrow key moves to from `active` among `count`, wrapping round; none when there are none. */
export function movedOption(active: number | null, count: number, direction: "up" | "down"): number | null {
  if (count === 0) return null;
  if (active === null) return direction === "down" ? 0 : count - 1;
  return (active + (direction === "down" ? 1 : count - 1)) % count;
}
