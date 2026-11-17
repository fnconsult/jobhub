/**
 * Jobbbox's symbol, « La boîte qui répond » (ADR-0105), as SVG markup for every surface that is not the web app's React
 * tree: the self-contained error pages, the extension's Side Panel, and the files drawn from it (the web manifest's
 * icons, the emails' PNG, the extension's and the app's icons, the splash screen). The web app's `design/Logo` draws
 * the same geometry and colours, taken from here, with its moving parts.
 *
 * Two forms: the `symbol` (the offer in the slot, the three dots of the coach answering) from 40 px, and the `small`
 * one below (flat: no gradient, no dots, no lines on the offer, which do not survive 16 px). Its colours are the
 * brand's, the same in both themes: they read on the light and on the dark background.
 *
 *   logoSvg("symbol")                                   decorative: the name beside it says « Jobbbox »
 *   logoSvg("small", { title: "Jobbbox" })              named, for a symbol shown alone
 *   logoIconSvg({ size: 512, background, inset })       the symbol on a tile, for an icon file
 */

/** The speech bubble: a rounded box with its tail at the bottom left. */
const BUBBLE = "M27 18H69a17 17 0 0 1 17 17V53a17 17 0 0 1-17 17H45L29 83.500V70H27a17 17 0 0 1-17-17V35a17 17 0 0 1 17-17z";

/** Where the symbol sits in its 96-unit drawing: the square around it, its origin and side. */
const BOX = { x: 4, y: 6, side: 88 } as const;

export const LOGO = {
  bubble: BUBBLE,
  /** The side of the square the symbol is drawn in (`viewBox="4 6 88 88"`). */
  box: BOX.side,
  colors: {
    /** The bubble's face, top to bottom; `flat` is the small form's. */
    front: ["#7482f5", "#5261e3"],
    flat: "#6170ee",
    /** The bubble's side, under its face; `flatSide` is the small form's. */
    side: ["#4350c8", "#3743b0"],
    flatSide: "#3d4abf",
    /** The highlight along the bubble's top edge. */
    highlight: "#d3d8ff",
    /** The slot the offer goes into. */
    slot: "#262d85",
    /** The offer's sheet, its edge, its mark and its lines. */
    paper: "#ffffff",
    paperShade: "#eceefb",
    paperEdge: "#c3c9f3",
    mark: "#6170ee",
    title: "#7d88e6",
    /** The three dots. */
    dot: "#dfe3ff",
  },
} as const;

export type LogoForm = "symbol" | "small";

/** The form that reads at `px`: the small one below 40 px. */
export function logoFormFor(px: number): LogoForm {
  return px < 40 ? "small" : "symbol";
}

/** The symbol's shapes, without its `<svg>`: ids prefixed with `id`. */
function shapes(form: LogoForm, id: string): string {
  const c = LOGO.colors;
  if (form === "small") {
    return (
      `<path fill="${c.flatSide}" transform="translate(0 6)" d="${BUBBLE}"/>` +
      `<path fill="${c.flat}" d="${BUBBLE}"/>` +
      `<rect fill="${c.paper}" x="33" y="12" width="30" height="24" rx="3"/>` +
      `<rect fill="${c.slot}" x="26" y="33" width="44" height="7" rx="3.500"/>`
    );
  }
  const gradient = (name: string, [top, bottom]: readonly [string, string]) =>
    `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const dot = (cx: number) => `<circle cx="${cx}" cy="55" r="4" fill="${c.dot}"/>`;
  return (
    `<defs>${gradient("front", c.front)}${gradient("side", c.side)}${gradient("paper", [c.paper, c.paperShade])}` +
    `<clipPath id="${id}-slot"><path d="M-20-90H116V36.500H-20z"/></clipPath></defs>` +
    `<path transform="translate(0 6.500)" d="${BUBBLE}" fill="url(#${id}-side)"/>` +
    `<path d="${BUBBLE}" fill="url(#${id}-front)"/>` +
    `<path d="M27 19.200H69" fill="none" stroke="${c.highlight}" stroke-width="1.300" stroke-linecap="round" opacity=".8"/>` +
    `<rect x="26" y="33" width="44" height="7.500" rx="3.750" fill="${c.slot}"/>` +
    `<g clip-path="url(#${id}-slot)">` +
    `<rect x="32" y="10" width="32" height="44" rx="3.200" fill="url(#${id}-paper)" stroke="${c.paperEdge}" stroke-width=".7"/>` +
    `<rect x="37" y="15.500" width="7" height="7" rx="2.200" fill="${c.mark}"/>` +
    `<path d="M48 17.200h9" fill="none" stroke="${c.title}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M48 21.600h3M37 29.500h22" fill="none" stroke="${c.paperEdge}" stroke-width="1.700" stroke-linecap="round"/>` +
    `</g>` +
    dot(34) +
    dot(48) +
    dot(62)
  );
}

/** The symbol in one colour, its slot and the offer's edge cut out: Android 13's monochrome icon reads its alpha only. */
function silhouette(id: string): string {
  return (
    `<mask id="${id}-cut"><rect x="${BOX.x}" y="${BOX.y}" width="${BOX.side}" height="${BOX.side}" fill="#ffffff"/>` +
    `<rect x="26" y="33" width="44" height="7" rx="3.500" fill="#000000"/>` +
    `<rect x="31" y="10" width="34" height="24" rx="3.500" fill="#000000"/></mask>` +
    `<g fill="#ffffff" mask="url(#${id}-cut)"><path transform="translate(0 6)" d="${BUBBLE}"/><path d="${BUBBLE}"/></g>` +
    `<rect x="34" y="13" width="28" height="18" rx="2" fill="#ffffff"/>`
  );
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The symbol as an `<svg>` (`viewBox="4 6 88 88"`), sized by whoever shows it. Decorative (`aria-hidden`) unless given
 * a `title`, for a symbol shown alone. `id` prefixes its gradients' ids: two symbols on one page need two.
 */
export function logoSvg(form: LogoForm, { id = "jb-logo", title, className }: { id?: string; title?: string; className?: string } = {}): string {
  const name = title ? ` role="img" aria-label="${escapeText(title)}"` : ` aria-hidden="true" focusable="false"`;
  const classes = className ? ` class="${className}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOX.x} ${BOX.y} ${BOX.side} ${BOX.side}"${classes}${name}>` +
    (title ? `<title>${escapeText(title)}</title>` : "") +
    shapes(form, id) +
    `</svg>`
  );
}

export interface LogoIcon {
  /** The icon's side, in pixels: its form follows (`logoFormFor`). */
  size: number;
  /** The tile's colour; none: transparent around the symbol. */
  background?: string;
  /** A rounded tile (an extension's or a web app's icon) or a square one, edge to edge (a maskable icon, a store's). */
  shape?: "rounded" | "square";
  /** The space around the symbol on each side, as a share of the size: a maskable icon keeps it in its safe circle. */
  inset?: number;
  /** One colour, the slot cut out: Android 13's themed icon. */
  monochrome?: boolean;
}

/** An icon file's SVG: the symbol on its tile, `inset` from each side. */
export function logoIconSvg({ size, background, shape = "rounded", inset = 0.06, monochrome = false }: LogoIcon): string {
  const id = "jb-icon";
  const side = size * (1 - 2 * inset);
  const scale = side / BOX.side;
  const at = size * inset;
  const round = (value: number) => Number(value.toFixed(3));
  const tile = background
    ? `<rect width="${size}" height="${size}"${shape === "rounded" ? ` rx="${round(size * 0.22)}"` : ""} fill="${background}"/>`
    : "";
  const symbol = monochrome ? silhouette(id) : shapes(logoFormFor(size), id);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    tile +
    `<g transform="translate(${round(at)} ${round(at)}) scale(${round(scale)})">` +
    `<g transform="translate(${-BOX.x} ${-BOX.y})">${symbol}</g>` +
    `</g></svg>`
  );
}
