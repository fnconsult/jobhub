"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorActions } from "@/components/ErrorActions";
import { ErrorView } from "@/design/ErrorView";
import { routes } from "@/routes";

/**
 * A page that failed (#542, an error.tsx): its shell cannot be drawn from the client, so the wordmark leads home above
 * the error. « Réessayer » fetches the page again; the digest (all a failed server page may show of its error) is
 * copyable, and in the Signalement « Signaler un problème » drafts. `home`: the role's.
 */
export function FailedPage({ error, retry, home = routes.home }: { error: Error & { digest?: string }; retry: () => void; home?: string }) {
  const { t } = useTranslation();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="ds-error-page">
      <Link className="ds-error-page__wordmark" href={home}>
        {t("app.name")}
      </Link>
      <ErrorView code={500} title={t("errorPage.error.title")} actions={<ErrorActions code={500} home={{ href: home, label: t("errorPage.actions.home") }} retry={retry} digest={error.digest} />}>
        <p>{t("errorPage.error.message")}</p>
      </ErrorView>
    </main>
  );
}
