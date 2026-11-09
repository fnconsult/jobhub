// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FICHE_WIDTH_STORAGE_KEY, ficheMaxWidth, ficheWidthFromKey, applyFicheWidth, readFicheWidth, writeFicheWidth } from "./fiche-width";

const REM = 16;

describe("how wide the Fiche may grow (#932)", () => {
  it("is never narrower than its default, 20rem", () => {
    expect(ficheMaxWidth({ viewport: 1024, workspace: 768, workPane: 0, rem: REM })).toBe(320);
  });

  it("stops at half the window", () => {
    // 1600px window, Sidebar hidden: the conversation would keep plenty, but half the window is 800px.
    expect(ficheMaxWidth({ viewport: 1600, workspace: 1600, workPane: 0, rem: REM })).toBe(704);
    expect(ficheMaxWidth({ viewport: 1400, workspace: 1400, workPane: 0, rem: REM })).toBe(700);
  });

  it("is capped at 44rem", () => {
    expect(ficheMaxWidth({ viewport: 2560, workspace: 2304, workPane: 0, rem: REM })).toBe(44 * REM);
  });

  it("leaves the conversation 28rem and its gutters", () => {
    // A laptop, 1280px, the Sidebar open (16rem): 1024px for the conversation and the Fiche.
    expect(ficheMaxWidth({ viewport: 1280, workspace: 1024, workPane: 0, rem: REM })).toBe(1024 - 31 * REM);
  });

  it("leaves room for the Work Pane and its gutter while it is open", () => {
    expect(
      ficheMaxWidth({
        viewport: 1920,
        workspace: 1664,
        workPane: 512,
        rem: REM,
      }),
    ).toBe(1664 - 31 * REM - 512 - REM);
  });

  it("follows the text size: the limits are in rem", () => {
    expect(ficheMaxWidth({ viewport: 1024, workspace: 768, workPane: 0, rem: 20 })).toBe(400);
  });
});

describe("the resize handle's keys (#932)", () => {
  const bounds = { min: 320, max: 640 };

  it("← widens the Fiche (the handle moves left), → narrows it, by a step", () => {
    expect(ficheWidthFromKey("ArrowLeft", 400, bounds)).toBe(432);
    expect(ficheWidthFromKey("ArrowRight", 400, bounds)).toBe(368);
  });

  it("stays within its limits", () => {
    expect(ficheWidthFromKey("ArrowLeft", 630, bounds)).toBe(640);
    expect(ficheWidthFromKey("ArrowRight", 330, bounds)).toBe(320);
  });

  it("Home goes to the narrowest, End to the widest", () => {
    expect(ficheWidthFromKey("Home", 400, bounds)).toBe(320);
    expect(ficheWidthFromKey("End", 400, bounds)).toBe(640);
  });

  it("ignores other keys", () => {
    expect(ficheWidthFromKey("Enter", 400, bounds)).toBeNull();
    expect(ficheWidthFromKey("ArrowUp", 400, bounds)).toBeNull();
  });
});

describe("the Fiche's width, remembered by this browser (#932)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--fiche-width");
  });

  it("is written and read back", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    writeFicheWidth(480);
    expect(store.get(FICHE_WIDTH_STORAGE_KEY)).toBe("480");
    expect(readFicheWidth()).toBe(480);
    writeFicheWidth(null);
    expect(readFicheWidth()).toBeNull();
  });

  it("is forgotten when unreadable, and storage that throws breaks nothing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readFicheWidth()).toBeNull();
    expect(() => writeFicheWidth(480)).not.toThrow();
  });

  it("ignores a stored value that is not a width", () => {
    vi.stubGlobal("localStorage", { getItem: () => "large" });
    expect(readFicheWidth()).toBeNull();
  });

  it("is set on <html> as --fiche-width, before first paint by the head's script", () => {
    vi.stubGlobal("localStorage", { getItem: () => "512" });
    new Function(applyFicheWidth)();
    expect(document.documentElement.style.getPropertyValue("--fiche-width")).toBe("512px");
  });
});
