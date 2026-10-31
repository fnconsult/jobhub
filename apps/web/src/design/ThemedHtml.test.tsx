// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ThemedHtml } from "./ThemedHtml";

/** The theme a component sees while the page is drawn: what the browser computes its colours from, when it reads its layout. */
function ThemeSeenOnDraw({ seen }: { seen: (string | undefined)[] }) {
  useLayoutEffect(() => {
    seen.push(document.documentElement.dataset.theme);
  });
  return null;
}

describe("ThemedHtml (#473)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  // Next's bare error shell (a page not found) has React draw the whole document on the client, which clears <html>'s
  // attributes: a page drawn without its theme, measured, then given it back, fades from light to dark.
  it("keeps the theme the document's head set while React draws the whole document on the client", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.documentElement.dataset.theme = "dark";
    const seen: (string | undefined)[] = [];
    const root = createRoot(document);
    await act(async () =>
      root.render(
        <ThemedHtml lang="fr">
          <head />
          <body>
            <ThemeSeenOnDraw seen={seen} />
          </body>
        </ThemedHtml>,
      ),
    );
    expect(seen).toEqual(["dark"]);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("fr");

    document.documentElement.dataset.theme = "light"; // Clair chosen in Préférences
    await act(async () => {});
    await act(async () =>
      root.render(
        <ThemedHtml lang="en">
          <head />
          <body />
        </ThemedHtml>,
      ),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => root.unmount());
  });
});
