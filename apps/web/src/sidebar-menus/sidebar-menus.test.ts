import { describe, expect, it } from "vitest";
import { unfoldMenu, type MenuObject } from "./index";

/** `count` objects, most recent first, named o1 (the most recent), o2…; those in `toHandle` are à traiter. */
function objects(count: number, toHandle: readonly number[] = []): MenuObject[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `o${index + 1}`,
    label: `Objet ${index + 1}`,
    href: `/objets/o${index + 1}`,
    toHandle: toHandle.includes(index + 1),
  }));
}

const ids = (menu: ReturnType<typeof unfoldMenu>) => menu.shown.map((object) => object.id);

describe("a Sidebar menu unfolds into its 5 to 10 most recent objects or those à traiter (ADR-0070, #604)", () => {
  it("shows every object of a menu that has five or fewer", () => {
    const menu = unfoldMenu(objects(3));
    expect(ids(menu)).toEqual(["o1", "o2", "o3"]);
    expect(menu.total).toBe(3);
  });

  it("shows the five most recent when none is à traiter, and counts them all for « Tout voir »", () => {
    const menu = unfoldMenu(objects(12));
    expect(ids(menu)).toEqual(["o1", "o2", "o3", "o4", "o5"]);
    expect(menu.total).toBe(12);
  });

  it("keeps an older object à traiter among the five, in place of the least recent one", () => {
    expect(ids(unfoldMenu(objects(12, [9, 11])))).toEqual(["o1", "o2", "o3", "o9", "o11"]);
  });

  it("shows every object à traiter, up to ten, in their order, when more than five are", () => {
    expect(ids(unfoldMenu(objects(12, [2, 3, 5, 7, 8, 10, 12])))).toEqual(["o2", "o3", "o5", "o7", "o8", "o10", "o12"]);
  });

  it("never shows more than ten: the ten most recent of those à traiter", () => {
    const toHandle = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(ids(unfoldMenu(objects(15, toHandle)))).toEqual(["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10"]);
  });

  it("has nothing to unfold for a menu with no object", () => {
    expect(unfoldMenu([])).toEqual({ shown: [], total: 0 });
  });
});
