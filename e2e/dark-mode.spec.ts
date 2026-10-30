import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { expectTextContrast } from "./support/theme";

// Issue #473 (ADR-0053): dark mode switched on. Mon compte › Préférences has a « Thème » choice, Clair, Sombre or
// Système (the default, following the device's prefers-color-scheme), remembered on the device like the Text Size and
// set on <html data-theme> before first paint, so a dark page never flashes light. Every key screen's dark baselines
// are in the screenshot specs (THEMES, e2e/support/theme.ts).
const fr = JSON.parse(
  readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"),
);
/** The dark canvas (#121219) and the light one, as the browser computes them. */
const DARK_CANVAS = "rgb(18, 18, 25)";
const LIGHT_CANVAS = "rgb(255, 255, 255)";

type FirstPaint = { theme: string | null; canvas: string; colorScheme: string };

/**
 * Records, from before the page's first script, the page as it would first be painted: the moment its <body> is in
 * the document (a mutation observer runs before the browser can paint), its theme, its canvas and its colour scheme.
 */
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      (window as unknown as { __firstPaint: FirstPaint }).__firstPaint = {
        theme: document.documentElement.dataset.theme ?? null,
        canvas: getComputedStyle(document.body).backgroundColor,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      };
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

const firstPaint = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __firstPaint: FirstPaint | undefined })
        .__firstPaint,
  );

/**
 * Records, from before the page's first script, every transition the page starts: a colour that moves as the page
 * loads is the page drawn in one theme, then moved to the other, a flash a person sees.
 */
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const started: string[] = [];
    (window as unknown as { __transitions: string[] }).__transitions = started;
    document.addEventListener(
      "transitionrun",
      (event) => {
        const el = event.target as Element;
        started.push(
          `${el.tagName}.${el.getAttribute("class") ?? ""} ${(event as TransitionEvent).propertyName}`,
        );
      },
      true,
    );
  });
}

/** The transitions the page started, once it has drawn a frame after its last change. */
const transitionsStarted = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              (window as unknown as { __transitions: string[] }).__transitions,
            ),
          ),
        ),
      ),
  );

/** Remembers a theme choice on this device as Préférences does. */
async function rememberTheme(page: Page, setting: "light" | "dark" | "system") {
  await page.evaluate(
    (value) => localStorage.setItem("jobbbox.theme", value),
    setting,
  );
}

test.describe("dark mode (#473)", () => {
  test("a device set to dark gets the dark theme on the very first paint, signed out or in, with no light flash", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await recordFirstPaint(page);
    await page.goto("/");
    expect(await firstPaint(page)).toEqual({
      theme: "dark",
      canvas: DARK_CANVAS,
      colorScheme: "dark",
    });
    await expectTextContrast(page, "the home page");

    await signInWithMagicLink(page, newAddress("dark-first-paint"));
    await page.goto("/compte/preferences");
    expect(await firstPaint(page)).toEqual({
      theme: "dark",
      canvas: DARK_CANVAS,
      colorScheme: "dark",
    });
    await expect(
      page.getByRole("radio", { name: fr.theme.system }),
    ).toHaveAttribute("aria-checked", "true");
    await expectTextContrast(page, "Préférences");
  });

  test("Sombre, chosen in Préférences, applies at once, is remembered, and is painted first on a light device", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInWithMagicLink(page, newAddress("dark-preference"));
    await page.goto("/compte/preferences");
    const html = page.locator("html");
    const group = page.getByRole("radiogroup", { name: fr.theme.label });
    await expect(group.getByRole("radio")).toHaveText([
      fr.theme.light,
      fr.theme.dark,
      fr.theme.system,
    ]);
    await expect(
      group.getByRole("radio", { name: fr.theme.system }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(html).toHaveAttribute("data-theme", "light");

    await group.getByRole("radio", { name: fr.theme.dark }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe(DARK_CANVAS);
    expect(
      await page.evaluate(() => localStorage.getItem("jobbbox.theme")),
    ).toBe("dark");

    await recordFirstPaint(page);
    await page.goto("/candidatures");
    expect(await firstPaint(page)).toEqual({
      theme: "dark",
      canvas: DARK_CANVAS,
      colorScheme: "dark",
    });
    await expectTextContrast(page, "Candidatures");
  });

  // A page that calls notFound() gets Next's bare error shell, its content drawn on the client, where the head's inline
  // script never runs (ErrorShellHead): every such 404 is checked here, unlike /nope-404, which no page answers.
  test("a page not found is dark too: the sidebar's 404 on a dark device, and with Sombre chosen on a light one", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInWithMagicLink(page, newAddress("dark-not-found"));
    await recordFirstPaint(page);
    await page.goto("/candidatures/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      fr.errorPage.notFound.title,
    );
    expect(await firstPaint(page)).toEqual({
      theme: "dark",
      canvas: DARK_CANVAS,
      colorScheme: "dark",
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectTextContrast(page, "the signed-in 404");

    await page.emulateMedia({ colorScheme: "light" });
    await rememberTheme(page, "dark");
    await page.goto("/offres/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      fr.errorPage.notFound.title,
    );
    expect(await firstPaint(page)).toEqual({
      theme: "dark",
      canvas: DARK_CANVAS,
      colorScheme: "dark",
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  // The 404's page is drawn on the client (ErrorShellHead): it must be drawn dark from the start, not drawn light and
  // then faded to dark, which a person sees as a light flash, and which leaves its buttons mid-fade, unreadable.
  test("a page not found on a dark device is drawn dark from the start: nothing fades from light to dark", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInWithMagicLink(page, newAddress("dark-not-found-no-fade"));
    await recordTransitions(page);
    await page.goto("/candidatures/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      fr.errorPage.notFound.title,
    );
    await page.waitForLoadState("load");
    expect(await transitionsStarted(page)).toEqual([]);
    await expectTextContrast(page, "the signed-in 404");
  });

  test("Clair holds on a dark device; Système follows the device, even as it changes", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInWithMagicLink(page, newAddress("dark-system"));
    await page.goto("/compte/preferences");
    await rememberTheme(page, "light");
    await recordFirstPaint(page);
    await page.reload();
    expect(await firstPaint(page)).toEqual({
      theme: "light",
      canvas: LIGHT_CANVAS,
      colorScheme: "light",
    });
    const group = page.getByRole("radiogroup", { name: fr.theme.label });
    await expect(
      group.getByRole("radio", { name: fr.theme.light }),
    ).toHaveAttribute("aria-checked", "true");

    await group.getByRole("radio", { name: fr.theme.system }).click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});
