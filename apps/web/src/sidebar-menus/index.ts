/**
 * The Sidebar's menus with objects (ADR-0070, #604): Mes candidatures unfolds into its Applications (Recherches d'offres
 * and Job Digests follow, #606). A menu shows its 5 to 10 most recent objects or those à traiter, each marked with a dot,
 * then « Tout voir (N) », which leads to the menu's page.
 */

/** One object of a menu as the Sidebar lists it: its name, its page, and whether something waits for the Candidate there. */
export type MenuObject = { id: string; label: string; href: string; toHandle: boolean };

/** What a menu unfolds into: the objects shown, in their order, and how many it has in all (« Tout voir (N) »). */
export type UnfoldedMenu = { shown: MenuObject[]; total: number };

/** At least this many objects are shown when the menu has them… */
export const MIN_SHOWN = 5;
/** …and never more than this many, however many are à traiter. */
export const MAX_SHOWN = 10;

/**
 * The objects a menu unfolds into, from `objects` most recent first: every one à traiter (the ten most recent of them at
 * most), then the most recent of the others until five are shown; in their order.
 */
export function unfoldMenu(objects: readonly MenuObject[]): UnfoldedMenu {
  const kept = new Set(objects.filter((object) => object.toHandle).slice(0, MAX_SHOWN));
  for (const object of objects) {
    if (kept.size >= MIN_SHOWN) break;
    kept.add(object);
  }
  return { shown: objects.filter((object) => kept.has(object)), total: objects.length };
}
