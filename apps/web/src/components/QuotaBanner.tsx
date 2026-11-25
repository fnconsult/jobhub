"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/components/ExternalLink";
import { Note } from "@/design/Note";
import type { QuotaBannerLine } from "@/quota-banner";
import "./QuotaBanner.css";

/** The banner's hook, as Consommation IA's web search alert has its own. */
const QUOTA_ALERT = "quota";

/**
 * The « Quota atteint » banner (#1115) at the head of every Back Office page: a warning, read out as a status, with one
 * line per Tool refused for its quota (its name, « limite atteinte » or « quota épuisé », since when, Paris time), a
 * link to its configuration when the reader may open it, and one to its provider's billing page, in a new tab through
 * the Back Office's Exit Page. Nothing while no Tool has reached its quota.
 */
export function QuotaBanner({ lines }: { lines: readonly QuotaBannerLine[] }) {
  const { t, i18n } = useTranslation();
  if (lines.length === 0) return null;
  const date = new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <div className="quota-banner">
      <Note tone="warn" role="status" data-alert={QUOTA_ALERT} title={t("admin.quotaBanner.title")}>
        <ul>
          {lines.map((line) => {
            const words = { tool: line.toolName, state: t(`admin.quotaBanner.states.${line.state}`) };
            return (
              <li key={line.toolId}>
                <p>{line.since ? t("admin.quotaBanner.line", { ...words, since: date.format(line.since) }) : t("admin.quotaBanner.lineNoSince", words)}</p>
                <p className="quota-banner__links">
                  {line.configHref ? (
                    <Link prefetch={false} href={line.configHref}>
                      {t("admin.quotaBanner.configure", { tool: line.toolName })}
                    </Link>
                  ) : null}
                  <ExternalLink href={line.billingUrl}>
                    {t("admin.quotaBanner.billing", { tool: line.toolName })}{" "}
                    <span className="visually-hidden">{t("admin.quotaBanner.newTab")}</span>
                  </ExternalLink>
                </p>
              </li>
            );
          })}
        </ul>
      </Note>
    </div>
  );
}
