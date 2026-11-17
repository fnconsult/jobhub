import { designTokens } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import type { MetadataRoute } from "next";
import { WEB_APP_ICONS } from "@/brand/files";

/**
 * The web manifest (#988), at `/manifest.webmanifest`: Jobbbox installed from the browser opens its home page, under
 * the logo « La boîte qui répond » (ADR-0105) at 192 and 512 px and as a maskable icon, its symbol inside the safe
 * circle. Its colours are the Design System's: the accent for the browser's bar, the page's background behind the
 * icon while it opens. Drawn by `npx tsx apps/web/scripts/draw-logo-files.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  const { t } = createI18n("fr");
  return {
    name: t("app.name"),
    short_name: t("app.name"),
    description: t("app.tagline"),
    lang: "fr",
    start_url: "/",
    display: "standalone",
    theme_color: designTokens.color.accent.light,
    background_color: designTokens.color.background.light,
    icons: [
      ...WEB_APP_ICONS.map(({ path, size, purpose }) => ({ src: path, sizes: `${size}x${size}`, type: "image/png", purpose })),
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" as const },
    ],
  };
}
