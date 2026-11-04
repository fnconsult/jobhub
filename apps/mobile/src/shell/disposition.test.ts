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
