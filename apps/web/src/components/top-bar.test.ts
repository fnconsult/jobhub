import { describe, expect, it } from "vitest";
import { arrangeTopBar, TOP_BAR_RANK, type TopBarAction } from "./top-bar";

const action = (id: string, rank: number, more: Partial<TopBarAction> = {}): TopBarAction => ({ id, rank, label: id, icon: () => null, run: () => {}, ...more });

const filter = action("filter", TOP_BAR_RANK.page);
const fiche = action("fiche", TOP_BAR_RANK.fiche);
const activity = action("activity", TOP_BAR_RANK.activity);
const clear = action("clear", TOP_BAR_RANK.clear);
const help = action("help", TOP_BAR_RANK.help);
const ids = (actions: readonly TopBarAction[]) => actions.map((each) => each.id);

describe("the compact Top Bar's one visible action, the rest under « … » (#897)", () => {
  it("shows the page's own action where it has one (Recherches d'offres' filter)", () => {
    const { shown, menu } = arrangeTopBar([clear, activity, filter]);

    expect(shown?.id).toBe("filter");
    expect(ids(menu)).toEqual(["activity", "clear"]);
  });

  it("shows « Fiche » on an object's page, « Activité » and « Effacer » under « … », in the wide bar's order", () => {
    const { shown, menu } = arrangeTopBar([clear, activity, fiche]);

    expect(shown?.id).toBe("fiche");
    expect(ids(menu)).toEqual(["activity", "clear"]);
  });

  it("otherwise shows « Activité »", () => {
    const { shown, menu } = arrangeTopBar([help, activity]);

    expect(shown?.id).toBe("activity");
    expect(ids(menu)).toEqual(["help"]);
  });

  it("shows « Activité » while an action runs, the page's action under « … » in its place", () => {
    const { shown, menu } = arrangeTopBar([clear, action("activity", TOP_BAR_RANK.activity, { running: true }), fiche]);

    expect(shown?.id).toBe("activity");
    expect(ids(menu)).toEqual(["fiche", "clear"]);
  });

  it("has nothing to show on a page without actions", () => {
    expect(arrangeTopBar([])).toEqual({ shown: null, menu: [] });
  });
});
