import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { inRoleShell } from "@/components/ErrorPage";
import { ExitCountdown } from "@/components/ExitCountdown";
import { ErrorView } from "@/design/ErrorView";
import { EXIT_PARAMETER, exitDestination, exitSite, type ExitShell } from "@/external-links";
import { getServerT } from "@/i18n/server";

const EXIT = "exit";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Its title, never indexed, and a destination that is not told which page of Jobbbox the person came from. */
export async function exitPageMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("errorPage.exit.title")} · ${t("app.name")}`, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * The Exit Page, in the shell of the person who reads it, as an error page (#542): « Vous quittez Jobbbox », the site
 * the link leads to and its full address, then ExitCountdown. A destination Jobbbox would not take anyone to (see
 * exitDestination) is a page not found.
 */
export async function ExitPage({ shell, searchParams }: { shell: ExitShell; searchParams: SearchParams }) {
  const destination = exitDestination((await searchParams)[EXIT_PARAMETER]);
  if (!destination) notFound();
  const t = await getServerT();
  const site = exitSite(destination);
  const url = destination.toString();
  return inRoleShell(shell, (home) => (
    <ErrorView code={EXIT} title={t("errorPage.exit.title")} actions={<ExitCountdown url={url} site={site} home={home} />}>
      <p>{t("errorPage.exit.message")}</p>
      <p className="ds-error__destination">
        <strong>{site}</strong>
        <span>{url}</span>
      </p>
    </ErrorView>
  ));
}
