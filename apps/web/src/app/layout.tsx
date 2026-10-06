import { designTokens, renderDesignCss, TEXT_SIZE_SETTINGS, TEXT_SIZE_STORAGE_KEY } from "@jobhub/shared/design";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale, getServerT } from "@/i18n/server";
import "./app.css";

export function generateMetadata(): Metadata {
  const t = getServerT();
  return { title: t("app.name"), description: t("app.tagline") };
}

const designCss = renderDesignCss(designTokens);

// Applies the stored text-size setting before first paint, so text never jumps.
const applyTextSize = `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(${JSON.stringify(
  TEXT_SIZE_SETTINGS,
)}.indexOf(s)>-1)document.documentElement.dataset.textSize=s}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  return (
    <html lang={locale} data-text-size="standard" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: designCss }} />
        <script dangerouslySetInnerHTML={{ __html: applyTextSize }} />
      </head>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
