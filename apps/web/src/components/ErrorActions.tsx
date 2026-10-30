"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { useOpenSignalement } from "@/components/Signalement";
import { buttonClass } from "@/design/button-class";
import { keepDraft } from "@/signalements/draft";

/**
 * An error page's actions (#542): « Réessayer » (`retry`, on a page that failed), « Page précédente », the role's home,
 * and « Signaler un problème »: the Signalement dialog with a Bug drafted (code, page, digest) where the page has one
 * (a signed-in Candidate, the Back Office), else an email to `contactEmail` (a Visitor, a Guest). Then the digest, to copy
 * for support: the one thing a failed page may show of its error.
 */
export function ErrorActions({ code, home, retry, digest, contactEmail }: { code: number; home: { href: string; label: string }; retry?: () => void; digest?: string; contactEmail?: string }) {
  const { t } = useTranslation();
  const openSignalement = useOpenSignalement();
  const [copied, setCopied] = useState(false);

  /** What a Signalement or an email about this error says first: the code, the page and the digest; the person then adds theirs. */
  function errorReport(): string {
    const path = window.location.pathname;
    return `${t("errorPage.report.text", { code, path })}${digest ? `\n${t("errorPage.report.digest", { digest })}` : ""}\n\n`;
  }

  function report() {
    keepDraft({ type: "bug", text: errorReport() });
    openSignalement?.({ kind: "type", type: "bug" });
  }

  function mailto(): string {
    const subject = t("errorPage.report.subject", { code });
    const body = errorReport();
    return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copy() {
    if (!digest) return;
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
    } catch {
      // No clipboard (an old browser, a denied permission): the digest stays selectable.
    }
  }

  return (
    <>
      <div className="ds-error__actions">
        {retry ? (
          <button className={buttonClass({ variant: "primary" })} type="button" onClick={retry}>
            {t("errorPage.actions.retry")}
          </button>
        ) : null}
        <Link className={buttonClass({ variant: retry ? "secondary" : "primary" })} href={home.href}>
          {home.label}
        </Link>
        <button className={buttonClass()} type="button" onClick={() => window.history.back()}>
          {t("errorPage.actions.back")}
        </button>
        {openSignalement ? (
          <button className={buttonClass({ variant: "quiet" })} type="button" onClick={report}>
            {t("errorPage.actions.report")}
          </button>
        ) : contactEmail ? (
          <button className={buttonClass({ variant: "quiet" })} type="button" onClick={() => window.location.assign(mailto())}>
            {t("errorPage.actions.report")}
          </button>
        ) : null}
      </div>
      {digest ? (
        <p className="ds-error__digest">
          <span>{t("errorPage.digest.label")}</span>
          <code>{digest}</code>
          <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" onClick={copy}>
            <Icons.copy />
            {copied ? t("errorPage.digest.copied") : t("errorPage.digest.copy")}
          </button>
        </p>
      ) : null}
    </>
  );
}
