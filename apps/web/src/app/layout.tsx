import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateCoachPanel } from "@/components/CoachPanel";
import { ResponseWatcher } from "@/components/ResponseWatcher";
import { DocumentHead } from "@/design/document-head";
import { ScrollbarActivity } from "@/design/ScrollbarActivity";
import { ThemedHtml } from "@/design/ThemedHtml";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { jobbboxVersion } from "@/signalements/server";
// Inter, self-hosted: its files are bundled and served from our own origin, never a font CDN (ADR-0053).
import "@fontsource-variable/inter";
import "./app.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("app.name"), description: t("app.tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  // The Coach Panel is on every page a signed-in Candidate sees but the Back
  // Office's, which has the Back Office Assistant. (Their own pages sit in the
  // sidebar layout, CandidateLayout, which also shows the Payment Failed Notice.)
  const candidate = await getCurrentCandidate();
  return (
    <ThemedHtml lang={locale} suppressHydrationWarning>
      <head>
        <DocumentHead />
      </head>
      <body>
        <ScrollbarActivity />
        <I18nProvider locale={locale}>
          {/* A session that expired, or too many requests, said wherever the page calls our API (#542). */}
          <ResponseWatcher signedIn={candidate !== null} />
          {candidate ? <CandidateCoachPanel version={jobbboxVersion()}>{children}</CandidateCoachPanel> : children}
        </I18nProvider>
      </body>
    </ThemedHtml>
  );
}
