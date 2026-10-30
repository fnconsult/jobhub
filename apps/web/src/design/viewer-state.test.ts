import { describe, expect, it } from "vitest";
import { fitZoom, initialViewer, nextViewer, zoomLabel } from "./viewer-state";

const loaded = nextViewer(initialViewer, { type: "loaded", pages: 2 });

describe("the Viewer's state (#468)", () => {
  it("opens on page 1 at 100 %, its page count known once the file is read", () => {
    expect(initialViewer).toEqual({ page: 1, pages: 0, zoom: 100 });
    expect(loaded).toEqual({ page: 1, pages: 2, zoom: 100 });
  });

  it("zooms in and out by 25 % steps, between 50 % and 200 %", () => {
    expect(nextViewer(loaded, { type: "zoomIn" }).zoom).toBe(125);
    expect(nextViewer(loaded, { type: "zoomOut" }).zoom).toBe(75);
    let state = loaded;
    for (let i = 0; i < 10; i++) state = nextViewer(state, { type: "zoomIn" });
    expect(state.zoom).toBe(200);
    for (let i = 0; i < 10; i++) state = nextViewer(state, { type: "zoomOut" });
    expect(state.zoom).toBe(50);
  });

  it("from a fitted zoom, steps to the next 25 % mark either way", () => {
    const fitted = nextViewer(loaded, { type: "fit", zoom: 137 });
    expect(fitted.zoom).toBe(137);
    expect(nextViewer(fitted, { type: "zoomIn" }).zoom).toBe(150);
    expect(nextViewer(fitted, { type: "zoomOut" }).zoom).toBe(125);
  });

  it("keeps the page shown between 1 and the page count", () => {
    expect(nextViewer(loaded, { type: "page", page: 2 }).page).toBe(2);
    expect(nextViewer(loaded, { type: "page", page: 5 }).page).toBe(2);
    expect(nextViewer(loaded, { type: "page", page: 0 }).page).toBe(1);
  });
});

describe("fitZoom: « Ajuster », the page as wide as the space beside the thumbnails", () => {
  it("is the width available over the page's width, in whole percent, kept between 50 % and 200 %", () => {
    expect(fitZoom({ pageWidth: 595, available: 893 })).toBe(150);
    expect(fitZoom({ pageWidth: 595, available: 400 })).toBe(67);
    expect(fitZoom({ pageWidth: 595, available: 100 })).toBe(50);
    expect(fitZoom({ pageWidth: 595, available: 4000 })).toBe(200);
  });
});

describe("zoomLabel", () => {
  it("writes the zoom as French and English readers do", () => {
    expect(zoomLabel(125, "fr")).toBe("125 %");
    expect(zoomLabel(125, "en")).toBe("125%");
  });
});
