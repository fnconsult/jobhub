import { disposition } from "./disposition";

const nothingOpen = { sidebar: true, pane: null, workPane: false } as const;

describe("disposition", () => {
  describe("measures the window in rem: 16 pt times the system text scale", () => {
    it("lays an iPhone out as a phone", () => {
      const layout = disposition({ width: 390, fontScale: 1 }, nothingOpen);
      expect(layout.widthRem).toBeCloseTo(24.375);
      expect(layout.panes).toBe("fullPage");
      expect(layout.sidebar).toBe("drawer");
    });

    it("lays an iPad in landscape out in columns", () => {
      const layout = disposition({ width: 1366, fontScale: 1 }, nothingOpen);
      expect(layout.panes).toBe("columns");
      expect(layout.sidebar).toBe("column");
    });

    it("falls back to the phone layout when the system text grows", () => {
      const layout = disposition({ width: 1366, fontScale: 1.5 }, nothingOpen);
      expect(layout.widthRem).toBeCloseTo(56.9, 1);
      expect(layout.panes).toBe("fullPage");
      expect(layout.sidebar).toBe("drawer");
    });

    it("draws the columns in points of the scaled rem", () => {
      const layout = disposition({ width: 1600, fontScale: 1.25 }, nothingOpen);
      expect(layout.rem).toBe(20);
      expect(layout.widthRem).toBe(80);
      expect(layout.size.sidebar).toBe(320);
      expect(layout.size.gutter).toBe(20);
    });
  });

  // On an iPhone SE at iOS's largest text size (3.57), a 1rem gutter each side of the conversation took 114 of its 375
  // points: « Propose / r une idée », « Contrôleus / e de gestion » broke mid-word in what was left (#905).
  describe("the conversation's side margin", () => {
    it("full page, is a gutter that stops growing at 16 pt: the words keep the window's width", () => {
      expect(disposition({ width: 375, fontScale: 3.571 }, nothingOpen).size.margin).toBe(16);
      expect(disposition({ width: 411, fontScale: 2 }, nothingOpen).size.margin).toBe(16);
      expect(disposition({ width: 1032, fontScale: 3.571 }, nothingOpen).size.margin).toBe(16);
      expect(disposition({ width: 375, fontScale: 1 }, nothingOpen).size.margin).toBe(16);
      expect(disposition({ width: 375, fontScale: 0.85 }, nothingOpen).size.margin).toBeCloseTo(13.6);
    });

    it("beside columns, is the gutter, which grows with the text", () => {
      const layout = disposition({ width: 1600, fontScale: 1.25 }, nothingOpen);
      expect(layout.panes).toBe("columns");
      expect(layout.size.margin).toBe(20);
    });
  });

  describe("the 64rem threshold", () => {
    it("puts the panes in columns from 64rem", () => {
      expect(disposition({ width: 1024, fontScale: 1 }, nothingOpen).panes).toBe("columns");
    });

    it("opens them full page below", () => {
      expect(disposition({ width: 1023, fontScale: 1 }, nothingOpen).panes).toBe("fullPage");
    });
  });

  describe("the Sidebar is a column while the conversation keeps 28rem", () => {
    const ficheOpen = { sidebar: true, pane: "fiche", workPane: false } as const;

    it("keeps it beside the conversation and the Fiche when there is room", () => {
      expect(disposition({ width: 67 * 16, fontScale: 1 }, ficheOpen).sidebar).toBe("column");
    });

    it("turns it into a drawer when the conversation would keep less than 28rem", () => {
      expect(disposition({ width: 66.9 * 16, fontScale: 1 }, ficheOpen).sidebar).toBe("drawer");
    });

    it("leaves it hidden when the person hid it", () => {
      expect(disposition({ width: 1366, fontScale: 1 }, { ...nothingOpen, sidebar: false }).sidebar).toBe("hidden");
    });

    it("keeps the drawer for a hidden Sidebar that would not fit anyway", () => {
      expect(disposition({ width: 66 * 16, fontScale: 1 }, { ...ficheOpen, sidebar: false }).sidebar).toBe("drawer");
    });
  });

  describe("the Work Pane takes the Fiche's place when there is no room for both", () => {
    const both = { pane: "fiche", workPane: true } as const;

    it("shows both from 100rem with the Sidebar", () => {
      const layout = disposition({ width: 100 * 16, fontScale: 1 }, { ...both, sidebar: true });
      expect(layout.shown).toEqual(["fiche", "workPane"]);
      expect(layout.sidebar).toBe("column");
    });

    it("shows the Work Pane alone below 100rem with the Sidebar", () => {
      const layout = disposition({ width: 99 * 16, fontScale: 1 }, { ...both, sidebar: true });
      expect(layout.shown).toEqual(["workPane"]);
      expect(layout.sidebar).toBe("column");
    });

    it("shows both from 76.5rem without the Sidebar", () => {
      expect(disposition({ width: 76.5 * 16, fontScale: 1 }, { ...both, sidebar: false }).shown).toEqual(["fiche", "workPane"]);
    });

    it("shows the Work Pane alone below 76.5rem without the Sidebar", () => {
      expect(disposition({ width: 76 * 16, fontScale: 1 }, { ...both, sidebar: false }).shown).toEqual(["workPane"]);
    });
  });

  describe("below 64rem the panes open full page", () => {
    it("shows the Fiche alone", () => {
      expect(disposition({ width: 390, fontScale: 1 }, { sidebar: true, pane: "fiche", workPane: false }).shown).toEqual(["fiche"]);
    });

    it("lays the Work Pane over the Fiche, the Fiche left beneath it", () => {
      expect(disposition({ width: 390, fontScale: 1 }, { sidebar: true, pane: "fiche", workPane: true }).shown).toEqual(["fiche", "workPane"]);
    });

    it("shows nothing when nothing is open", () => {
      expect(disposition({ width: 390, fontScale: 1 }, nothingOpen).shown).toEqual([]);
    });
  });
});

/**
 * An iPad Pro 12.9" in landscape, 1366 pt wide, shared in Split View (Apple's Human Interface Guidelines, « Layout »):
 * a third is 375 pt, a half 678 pt, two thirds 981 pt, all three under 64rem; Stage Manager resizes a window freely.
 */
describe("disposition on an iPad in landscape, in Split View", () => {
  const ficheOpen = { sidebar: true, pane: "fiche", workPane: false } as const;
  const at = (width: number) => disposition({ width, fontScale: 1 }, ficheOpen);

  it("lays a third of the screen out as a phone: the Fiche full page, the Sidebar a drawer", () => {
    expect(at(375)).toMatchObject({ panes: "fullPage", sidebar: "drawer", shown: ["fiche"] });
  });

  it("lays half of it out as a phone", () => {
    expect(at(678)).toMatchObject({ panes: "fullPage", sidebar: "drawer", shown: ["fiche"] });
  });

  it("lays two thirds of it out as a phone too, 981 pt being just under 64rem", () => {
    expect(at(981)).toMatchObject({ panes: "fullPage", sidebar: "drawer", shown: ["fiche"] });
  });

  it("lays the whole screen out in columns, the Sidebar beside the conversation and the Fiche", () => {
    expect(at(1366)).toMatchObject({ panes: "columns", sidebar: "column", shown: ["fiche"] });
  });

  it("lays out a Stage Manager window from its own width: columns from 64rem, the Sidebar a drawer without 28rem left", () => {
    expect(at(1040)).toMatchObject({ panes: "columns", sidebar: "drawer", shown: ["fiche"] });
  });
});
