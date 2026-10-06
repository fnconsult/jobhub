import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocumentHead } from "@/design/document-head";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale, getServerT } from "@/i18n/server";
import "./app.css";

export function generateMetadata(): Metadata {
  const t = getServerT();
  return { title: t("app.name"), description: t("app.tagline") };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  return (
    <html lang={locale} data-text-size="standard" suppressHydrationWarning>
      <head>
        <DocumentHead />
      </head>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
