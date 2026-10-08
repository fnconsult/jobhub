import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentCandidate } from "@/auth/server";
import { CoachPanel } from "@/components/CoachPanel";
import { DocumentHead } from "@/design/document-head";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale, getServerT } from "@/i18n/server";
import "./app.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("app.name"), description: t("app.tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  // The Coach Panel is on every page a signed-in Candidate sees.
  const candidate = await getCurrentCandidate();
  return (
    <html lang={locale} data-text-size="standard" suppressHydrationWarning>
      <head>
        <DocumentHead />
      </head>
      <body>
        <I18nProvider locale={locale}>{candidate ? <CoachPanel>{children}</CoachPanel> : children}</I18nProvider>
      </body>
    </html>
  );
}
