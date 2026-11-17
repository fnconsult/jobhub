/**
 * The extension's logo « La boîte qui répond » (#988, ADR-0105), from @jobhub/shared/logo: the Side Panel's header and
 * the icons of its two builds, which `scripts/draw-icons.ts` draws into `public/<set>/<size>.png`.
 */
import { logoIconSvg, logoSvg } from "@jobhub/shared/logo";

/** The beta build's mark (#563): an orange β, so the public and the beta builds side by side are never confused. */
const BETA = { color: "#c2410c", ink: "#ffffff" } as const;

/** Each drawing of the header gets ids of its own. */
let drawings = 0;

/** The header's logo: the symbol, still and decorative, then `name` in text, its accessible name. */
export function panelLogo(document: Document, name: string): HTMLElement {
  const logo = document.createElement("span");
  logo.className = "wordmark";
  drawings += 1;
  const svg = new DOMParser().parseFromString(logoSvg("symbol", { id: `jb-panel-logo-${drawings}` }), "image/svg+xml").documentElement;
  logo.append(document.importNode(svg, true), name);
  return logo;
}

export type IconSet = "icon" | "icon-beta";

/**
 * An icon's SVG: the logo on no background (the browser's toolbar is light or dark), flat at 16 and 32 px; the beta's
 * with its orange β in the corner, a plain dot where the letter would not read.
 */
export function extensionIcon(set: IconSet, size: number): string {
  const icon = logoIconSvg({ size, inset: 0.02 });
  if (set === "icon") return icon;
  const r = size * 0.24;
  const at = size - r;
  const letter =
    size >= 48
      ? `<text x="${at}" y="${at + r * 0.36}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${r * 1.15}" font-weight="700" fill="${BETA.ink}">β</text>`
      : "";
  return icon.replace(/<\/svg>$/, `<circle cx="${at}" cy="${at}" r="${r}" fill="${BETA.color}"/>${letter}</svg>`);
}
