import { designTokens, renderDesignCss, TEXT_SIZE_SETTINGS, TEXT_SIZE_STORAGE_KEY, themeScript } from "@jobhub/shared/design";
import { ErrorShellHead } from "./ErrorShellHead";
import { applySidebarState } from "./sidebar-state";

const designCss = renderDesignCss(designTokens);

// Applies the stored text-size setting before first paint, so text never jumps.
const applyTextSize = `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(${JSON.stringify(
  TEXT_SIZE_SETTINGS,
)}.indexOf(s)>-1)document.documentElement.dataset.textSize=s}catch(e){}`;

/**
 * The theme and the design tokens for a document whose own <head> never ran (#473): Next's bare error shell, sent for
 * every page that calls `notFound()`, where React then draws the whole page on the client and its inline scripts never
 * run. Nothing on a page whose head set the theme already. The CSS goes in as a JSON string, `<` escaped, so it cannot
 * close the script.
 */
export function errorShellHeadScript(css: string): string {
  const cssText = JSON.stringify(css).replace(/</g, "\\u003c");
  return `if(!document.documentElement.dataset.theme){${themeScript()}var s=document.createElement("style");s.textContent=${cssText};document.head.appendChild(s)}`;
}

/**
 * Design tokens, the theme (Clair, Sombre or Système, #473), the remembered
 * text size (ADR-0009) and whether the sidebar was hidden, all set before
 * first paint, so a dark page never flashes light. Every document the app
 * renders, including the root error boundary that replaces the root layout,
 * puts this in its <head>. A page not found gets Next's bare error shell
 * instead of it: ErrorShellHead puts the theme and the tokens there.
 */
export function DocumentHead() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: designCss }} />
      <script dangerouslySetInnerHTML={{ __html: themeScript() + applyTextSize + applySidebarState }} />
      <ErrorShellHead script={errorShellHeadScript(designCss)} />
    </>
  );
}
