import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pendingAcceptance } from "@/acceptances/server";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateProviders } from "@/components/CandidateProviders";
import { ResponseWatcher } from "@/components/ResponseWatcher";
import { DocumentHead } from "@/design/document-head";
import { ScrollbarActivity } from "@/design/ScrollbarActivity";
import { ThemedHtml } from "@/design/ThemedHtml";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { NOINDEX } from "@/public-pages/indexing";
import { jobbboxVersion } from "@/signalements/server";
// Inter, self-hosted: its files are bundled and served from our own origin, never a font CDN (ADR-0053).
import "@fontsource-variable/inter";
import "./app.css";

/** Every page is `noindex` but the public ones indexed, whose own metadata says so (#545, see public-pages/indexing). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("app.name"), description: t("app.tagline"), robots: NOINDEX };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  // AI Activity's live actions follow a signed-in Candidate from page to page, the Back Office's aside (their own pages
  // sit in the sidebar layout, CandidateLayout, whose conversations are the pages, ADR-0070). Not while a CGU version
  // waits for their Acceptance (ADR-0062): the AI Coach waits too.
  const candidate = await getCurrentCandidate();
  const coached = candidate !== null && !(await pendingAcceptance(candidate.id));
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
          {coached ? <CandidateProviders version={jobbboxVersion()}>{children}</CandidateProviders> : children}
        </I18nProvider>
      </body>
    </ThemedHtml>
  );
}
