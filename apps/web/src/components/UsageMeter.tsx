"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageMeter as Meter } from "@/billing/usage-meter";
import { HelpTerm } from "@/components/HelpTerm";
import { routes } from "@/routes";

/**
 * The sidebar's Usage Meter (ADR-0032): one bar for the week's Plan Quotas, each
 * weighed by what the Plan grants. The button shows each quota's use, and the
 * Job Digest's frequency, under it; the link leads to the subscription page.
 */
export function UsageMeter({
  meter,
  onNavigate,
}: {
  meter: Meter;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const summary =
    meter.percent === null
      ? t("usageMeter.unlimited")
      : t("usageMeter.percent", { percent: meter.percent });

  return (
    <div className="usage-meter">
      <button
        className="usage-meter-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-detail` : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="usage-meter-head">
          <span>{t("usageMeter.title")}</span>
          <span>{summary}</span>
        </span>
        {meter.percent === null ? null : (
          <span
            className="usage-meter-bar"
            role="progressbar"
            aria-label={t("usageMeter.title")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={meter.percent}
            aria-valuetext={t("usageMeter.valueText", {
              used: meter.used,
              allowed: meter.allowed,
              percent: meter.percent,
            })}
          >
            <span style={{ width: `${meter.percent}%` }} />
          </span>
        )}
      </button>
      {/* Rendered only while open: the page's own usage list (/abonnement) stays the only one there. */}
      {open ? (
        <div id={`${id}-detail`} className="usage-meter-detail">
          <dl>
            {meter.quotas.map(({ quota, used, limit }) => (
              <div key={quota}>
                <dt>{t(`billing.quotas.${quota}`)}</dt>
                <dd>
                  {limit === 0
                    ? t("billing.page.notIncluded")
                    : limit === null
                      ? t("billing.page.usageUnlimited", { used })
                      : t("billing.page.usage", { used, limit })}
                </dd>
              </div>
            ))}
            <div>
              <dt>{t("billing.quotas.jobDigest")}</dt>
              <dd>{t(`billing.jobDigest.${meter.jobDigest}`)}</dd>
            </div>
          </dl>
          <p className="hint">
            <HelpTerm term="planQuota" words={t("helpTerms.words.planQuota")}>
              {t("billing.quotaReached.renews")}
            </HelpTerm>
          </p>
          <Link href={routes.subscription} onClick={onNavigate}>
            {t("usageMeter.subscription")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
