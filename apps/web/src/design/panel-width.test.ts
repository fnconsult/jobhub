// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPanelWidths, panelMaxWidth, SIDE_PANEL_WIDTH, WORK_PANE_WIDTH } from "./panel-width";

const REM = 16;

describe("the Work Pane's width (#932)", () => {
  it("is by default 32% of the window, between 20rem and 32rem, as app.css draws it", () => {
    expect(WORK_PANE_WIDTH.defaultWidth({ viewport: 1024, rem: REM })).toBe(328);
    expect(WORK_PANE_WIDTH.defaultWidth({ viewport: 800, rem: REM })).toBe(320);
    expect(WORK_PANE_WIDTH.defaultWidth({ viewport: 2560, rem: REM })).toBe(512);
  });

  it("is never narrower than 20rem, where what it holds fits without a horizontal scrollbar", () => {
    expect(panelMaxWidth(WORK_PANE_WIDTH, { viewport: 1024, workspace: 768, other: 0, rem: REM })).toBe(320);
  });

  it("grows to half the window, 56rem at most, leaving the conversation 28rem and the side panel its width", () => {
    expect(panelMaxWidth(WORK_PANE_WIDTH, { viewport: 1600, workspace: 1600, other: 0, rem: REM })).toBe(800);
    expect(panelMaxWidth(WORK_PANE_WIDTH, { viewport: 3000, workspace: 3000, other: 0, rem: REM })).toBe(56 * REM);
    expect(panelMaxWidth(WORK_PANE_WIDTH, { viewport: 1600, workspace: 1344, other: 320, rem: REM })).toBe(1344 - 31 * REM - 320 - REM);
  });

  it("and the side panel's, leaving room for the Work Pane", () => {
    expect(panelMaxWidth(SIDE_PANEL_WIDTH, { viewport: 1920, workspace: 1664, other: 512, rem: REM })).toBe(1664 - 31 * REM - 512 - REM);
  });
});

describe("the widths remembered, before first paint (#932)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--fiche-width");
    document.documentElement.style.removeProperty("--work-pane-width");
  });

  it("are set on <html>, each column's own, a stray value ignored", () => {
    const store = new Map([
      [SIDE_PANEL_WIDTH.storageKey, "480"],
      [WORK_PANE_WIDTH.storageKey, "99999"],
    ]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null });
    new Function(applyPanelWidths)();
    expect(document.documentElement.style.getPropertyValue("--fiche-width")).toBe("480px");
    expect(document.documentElement.style.getPropertyValue("--work-pane-width")).toBe("");

    store.set(WORK_PANE_WIDTH.storageKey, "640");
    new Function(applyPanelWidths)();
    expect(document.documentElement.style.getPropertyValue("--work-pane-width")).toBe("640px");
  });
});
