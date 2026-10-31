"use client";

import type { HTMLAttributes } from "react";
import { useSyncExternalStore } from "react";

/** Calls back on each change to <html data-theme>: Préférences, or the device under Système (themeScript). */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

const currentTheme = () => document.documentElement.dataset.theme;
// The server cannot know the theme (it is the device's choice): its HTML has none, and the head's script sets it.
const noTheme = () => undefined;

/**
 * The document's <html>, at the Standard Text Size until the head's script sets the remembered one, and with the
 * theme the head's script set before first paint (#473) among its attributes. When React draws the whole document on the client (Next's bare error shell for a page not found, or after a hydration
 * mismatch), it clears <html>'s attributes and sets the ones it renders: rendering the theme there keeps it on, so no
 * element is ever drawn, and measured, without it, then faded from light to dark.
 */
export function ThemedHtml(props: HTMLAttributes<HTMLHtmlElement>) {
  const theme = useSyncExternalStore(subscribe, currentTheme, noTheme);
  return <html data-text-size="standard" {...props} data-theme={theme} />;
}
