"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UsageMeter as Meter } from "@/billing/usage-meter";
import { HelpText } from "@/components/HelpTerm";
import { buttonClass } from "@/design/Button";
import { routes } from "@/routes";

/**
 * The sidebar's Usage Meter (ADR-0032): « Hebdomadaire », one bar for the week's Plan Quotas, each
 * weighed by what the Plan grants, and under it, on one line, when they renew. The button opens a
 * small card above the meter (#321), so the sidebar's foot never moves: each quota's use, the Job
 * Digest's frequency, and a link to the subscription page. Escape closes it, the focus back on the button.
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
  const toggle = useRef<HTMLButtonElement>(null);
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    toggle.current?.focus();
  };
  const summary =
    meter.percent === null
      ? t("usageMeter.unlimited")
      : t("usageMeter.percent", { percent: meter.percent });

  return (
    // While open, Escape closes the card first; the phone's drawer stays open (SidebarShell).
    <div className="usage-meter" data-closes-on-escape={open ? "" : undefined} onKeyDown={closeOnEscape}>
      <button
        ref={toggle}
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
          <Link className={buttonClass({ size: "sm" })} href={routes.subscription} onClick={onNavigate}>
            {t("usageMeter.subscription")}
          </Link>
        </div>
      ) : null}
      {/* Metadata (ADR-0009 amendment), cut with an ellipsis rather than wrapped. Its glossary term opens its Help
          Article only while the card is open, as it did in the card (#343): the sidebar adds no stop to every page's
          Tab order, and on a phone the drawer's meter, not the hidden docked one, holds the page's first mention. */}
      <p className="usage-meter-renews">
        {open ? <HelpText terms={{ planQuota: t("helpTerms.words.planQuota") }}>{t("usageMeter.renews")}</HelpText> : t("usageMeter.renews")}
      </p>
    </div>
  );
}
