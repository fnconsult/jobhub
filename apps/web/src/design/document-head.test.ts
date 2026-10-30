// @vitest-environment jsdom
import { THEME_STORAGE_KEY } from "@jobhub/shared/design";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorShellHeadScript } from "./document-head";

const CSS = ":root{--color-canvas:#fff}body{background:var(--color-canvas)}";

/** Runs the script as the <head> of the page Next sent would. */
function run() {
  new Function(errorShellHeadScript(CSS))();
}

function prefersDark(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches, addEventListener() {}, removeEventListener() {} }));
}

describe("errorShellHeadScript (#473)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("on Next's bare error shell (a page not found: no head of ours ran), sets the theme and the design tokens before first paint", () => {
    prefersDark(true);
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect([...document.head.querySelectorAll("style")].map((style) => style.textContent)).toEqual([CSS]);
  });

  it("follows the choice made in Préférences there too", () => {
    prefersDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("does nothing on a page whose own head already set the theme", () => {
    prefersDark(true);
    document.documentElement.dataset.theme = "light";
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
  });

  it("cannot close its <script> early, whatever the CSS holds", () => {
    expect(errorShellHeadScript("a::after{content:'</script>'}")).not.toContain("</");
  });
});
