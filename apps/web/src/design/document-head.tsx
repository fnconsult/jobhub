import { designTokens, renderDesignCss, TEXT_SIZE_SETTINGS, TEXT_SIZE_STORAGE_KEY } from "@jobhub/shared/design";

const designCss = renderDesignCss(designTokens);

// Applies the stored text-size setting before first paint, so text never jumps.
const applyTextSize = `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(${JSON.stringify(
  TEXT_SIZE_SETTINGS,
)}.indexOf(s)>-1)document.documentElement.dataset.textSize=s}catch(e){}`;

/**
 * Design tokens and the remembered text size (ADR-0009). Every document the
 * app renders, including the root error boundary that replaces the root
 * layout, puts this in its <head>.
 */
export function DocumentHead() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: designCss }} />
      <script dangerouslySetInnerHTML={{ __html: applyTextSize }} />
    </>
  );
}
