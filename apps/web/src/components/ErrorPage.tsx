import type { Metadata } from "next";
import type { ReactNode } from "react";
import { backOfficeAdministrator } from "@/admin/server";
import { getCurrentCandidate } from "@/auth/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachSpaceHeader } from "@/components/CoachSpaceHeader";
import { ErrorActions } from "@/components/ErrorActions";
import { SignalementProvider } from "@/components/Signalement";
import { ErrorView } from "@/design/ErrorView";
import { PublicSite } from "@/design/PublicSite";
import { currentHumanCoach } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { routes } from "@/routes";
import { jobbboxVersion } from "@/signalements/server";

/** The error pages a shell draws itself (#542): a page not found, or one reserved for another role. */
export type ShellErrorCode = 404 | 403;

/** The shell an error page is drawn in: the role's. */
export type ErrorShell = "site" | "backOffice" | "coachSpace";

const COPY = { 404: "notFound", 403: "forbidden" } as const;

/** Its title, for generateMetadata. */
export async function errorPageMetadata(code: ShellErrorCode): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t(`errorPage.${COPY[code]}.title`)} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * Where a Visitor or a Guest writes about an error: the address Jobbbox's emails come from (MAIL_FROM), not a
 * development one. None: they get no « Signaler un problème », the page still says what to do.
 */
function contactEmail(): string | undefined {
  const from = getPlatformSettingsResolver().current().setting("MAIL_FROM")?.value.trim() ?? "";
  const address = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
  return address.includes("@") && !address.endsWith("@localhost") ? address : undefined;
}

/**
 * A 404 or a 403 in the shell of the person who meets it (#542): the Back Office's, for an Administrator under
 * `/admin`; the coach space's, for a Human Coach under `/espace-coach`; the sidebar for a signed-in Candidate; the
 * public site's header for a Visitor or a Guest. The Back Office's stays unseen by anyone else (`requireBackOffice`).
 */
export async function ShellErrorPage({ code, shell = "site" }: { code: ShellErrorCode; shell?: ErrorShell }) {
  const t = await getServerT();
  const copy = COPY[code];
  const view = (home: { href: string; label: string }, email?: string): ReactNode => (
    <ErrorView code={code} title={t(`errorPage.${copy}.title`)} actions={<ErrorActions code={code} home={home} contactEmail={email} />}>
      <p>{t(`errorPage.${copy}.message`)}</p>
    </ErrorView>
  );

  if (shell === "backOffice") {
    const administrator = await backOfficeAdministrator();
    if (administrator) {
      return (
        <BackOfficeLayout access={administrator.access}>
          <SignalementProvider version={jobbboxVersion()}>{view({ href: routes.admin, label: t("errorPage.actions.backOfficeHome") })}</SignalementProvider>
        </BackOfficeLayout>
      );
    }
  }
  if (shell === "coachSpace" && (await currentHumanCoach())) {
    return (
      <main className="page">
        <CoachSpaceHeader />
        {view({ href: routes.coachSpace, label: t("errorPage.actions.coachSpaceHome") })}
      </main>
    );
  }
  const candidate = await getCurrentCandidate();
  if (candidate) {
    return <CandidateLayout candidateId={candidate.id}>{view({ href: routes.account, label: t("errorPage.actions.home") })}</CandidateLayout>;
  }
  return (
    <PublicSite>
      <main id="main" className="ds-site__page">
        {view({ href: routes.home, label: t("errorPage.actions.home") }, contactEmail())}
      </main>
    </PublicSite>
  );
}
