"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type State = { kind: "shown"; summary: string } | { kind: "pending" } | { kind: "none" };

/**
 * The Job Offer Summary at the top of the Application page's header, in a tile labelled as written
 * by the AI (ADR-0009: words). A Job Offer stored without one gets it once the page is shown: asked
 * for here, so the page never waits for the AI; meanwhile a short status, and nothing if it fails.
 * When that reading also found facts the offer lacked (its sector among them), the page is shown again
 * with them; `needsReading` asks for it when the summary is there but the sector was never read.
 */
export function JobOfferSummary({ applicationId, summary, needsReading }: { applicationId: string; summary?: string; needsReading: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>(summary ? { kind: "shown", summary } : { kind: "pending" });
  if (summary && (state.kind !== "shown" || state.summary !== summary)) setState({ kind: "shown", summary });

  const missing = needsReading;
  useEffect(() => {
    if (!missing) return;
    let current = true;
    (async () => {
      try {
        const response = await fetch(`/api/applications/${applicationId}/job-offer-summary`, { method: "POST" });
        const body = (await response.json().catch(() => ({}))) as { summary?: unknown; fieldsAdded?: unknown };
        if (!current) return;
        if (response.ok && typeof body.summary === "string" && body.summary) setState({ kind: "shown", summary: body.summary });
        else setState({ kind: "none" });
        if (response.ok && body.fieldsAdded === true) router.refresh();
      } catch {
        if (current) setState({ kind: "none" });
      }
    })();
    return () => {
      current = false;
    };
  }, [applicationId, missing, router]);

  if (state.kind === "none") return null;
  if (state.kind === "pending") {
    return (
      <p className="hint job-offer-summary" role="status">
        {t("jobOffer.summaryPending")}
      </p>
    );
  }
  return (
    <dl className="tiles job-offer-summary" aria-label={t("jobOffer.summaryLabel")}>
      <div className="tile-wide">
        <dt>{t("jobOffer.summaryLabel")}</dt>
        <dd>{state.summary}</dd>
      </div>
    </dl>
  );
}
