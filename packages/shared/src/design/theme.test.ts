import { describe, expect, it } from "vitest";
import { followTheme, resolveTheme, THEME_SETTINGS, THEME_STORAGE_KEY, themeScript } from "./index";

describe("resolveTheme (#473)", () => {
  it("offers three choices, in Préférences' order: Clair, Sombre, Système", () => {
    expect(THEME_SETTINGS).toEqual(["light", "dark", "system"]);
  });

  it("keeps the Candidate's explicit choice whatever the system prefers", () => {
    expect(resolveTheme("light", true)).toEqual({ setting: "light", theme: "light" });
    expect(resolveTheme("dark", false)).toEqual({ setting: "dark", theme: "dark" });
  });

  it("follows the system's preference under Système", () => {
    expect(resolveTheme("system", true)).toEqual({ setting: "system", theme: "dark" });
    expect(resolveTheme("system", false)).toEqual({ setting: "system", theme: "light" });
  });

  it("falls back to Système, the default, for a missing or unknown stored value", () => {
    expect(resolveTheme(null, true)).toEqual({ setting: "system", theme: "dark" });
    expect(resolveTheme("sepia", false)).toEqual({ setting: "system", theme: "light" });
  });
});

/** A device's colour-scheme preference, which the test can change. */
function fakeMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches: prefersDark,
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
    prefer(dark: boolean) {
      this.matches = dark;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("followTheme (#473)", () => {
  it("sets the root's theme from the stored choice, and follows the device under Système until stopped", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const media = fakeMedia(false);
    let stored: string | null = "system";
    const stop = followTheme(root, media, () => stored);
    expect(root.dataset.theme).toBe("light");

    media.prefer(true);
    expect(root.dataset.theme).toBe("dark");

    stored = "light";
    media.prefer(false);
    media.prefer(true);
    expect(root.dataset.theme).toBe("light");

    stored = "system";
    stop();
    media.prefer(false);
    expect(root.dataset.theme).toBe("light");
    media.prefer(true);
    expect(root.dataset.theme).toBe("light");
  });
});

describe("themeScript (#473)", () => {
  /** Runs the inline script as a page's <head> would, on a fake document, storage and device. */
  function run(stored: string | null, media: ReturnType<typeof fakeMedia>, { storageThrows = false } = {}) {
    const documentElement = { dataset: {} as Record<string, string | undefined> };
    const localStorage = {
      getItem(key: string) {
        if (storageThrows) throw new Error("SecurityError");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const matchMedia = (query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return media;
    };
    new Function("document", "localStorage", "matchMedia", themeScript())({ documentElement }, localStorage, matchMedia);
    return documentElement;
  }

  it("sets <html data-theme> before first paint from the stored choice", () => {
    expect(run("dark", fakeMedia(false)).dataset.theme).toBe("dark");
    expect(run("light", fakeMedia(true)).dataset.theme).toBe("light");
  });

  it("follows the device under Système, the default, and keeps following it", () => {
    const media = fakeMedia(true);
    const root = run(null, media);
    expect(root.dataset.theme).toBe("dark");
    media.prefer(false);
    expect(root.dataset.theme).toBe("light");
  });

  it("still follows the device when storage cannot be read", () => {
    expect(run("light", fakeMedia(true), { storageThrows: true }).dataset.theme).toBe("dark");
  });
});
