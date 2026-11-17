/**
 * The web app's files drawn from the logo « La boîte qui répond » (#988, ADR-0105), served from `public/brand/` to
 * anyone, mid sign-in and during maintenance included: the web manifest's icons and the emails' header. Drawn from
 * `@jobhub/shared/logo` by `npx tsx apps/web/scripts/draw-logo-files.ts`; commit the PNGs it writes.
 */
import type { LogoIcon } from "@jobhub/shared/logo";
import { designTokens } from "@jobhub/shared/design";

/** Where they are served. */
export const BRAND_PREFIX = "/brand";

export interface BrandFile {
  /** Its path on the site, under BRAND_PREFIX. */
  path: string;
  /** What it draws (`logoIconSvg`). */
  icon: LogoIcon;
}

const tile = designTokens.color.accentSoft.light;

/** The web manifest's icons: the logo on its tile at 192 and 512 px, and edge to edge, its symbol in the safe circle. */
export const WEB_APP_ICONS = [
  { path: `${BRAND_PREFIX}/icon-192.png`, size: 192, purpose: "any", icon: { size: 192, background: tile, inset: 0.12 } },
  { path: `${BRAND_PREFIX}/icon-512.png`, size: 512, purpose: "any", icon: { size: 512, background: tile, inset: 0.12 } },
  { path: `${BRAND_PREFIX}/icon-maskable-512.png`, size: 512, purpose: "maskable", icon: { size: 512, background: tile, shape: "square", inset: 0.24 } },
] as const satisfies readonly (BrandFile & { size: number; purpose: "any" | "maskable" })[];

/** The emails' header shows the symbol at this size, in CSS pixels; its PNG is twice as large (@2x). */
export const EMAIL_LOGO_SIZE = 28;

/** The symbol of the emails' header, on no background: it reads on the light and on the dark one alike. */
export const EMAIL_LOGO = { path: `${BRAND_PREFIX}/email-logo@2x.png`, icon: { size: 2 * EMAIL_LOGO_SIZE, inset: 0 } } as const satisfies BrandFile;

/** Every file the script draws. */
export const BRAND_FILES: readonly BrandFile[] = [...WEB_APP_ICONS, EMAIL_LOGO];
