"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import { bringActionCardsIntoView } from "./ActionCardList";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";

/**
 * Computes the Profile's ATS Score (counted against the Plan Quota), then shows
 * it and the fixes proposed: once the page has them, the Action Cards are
 * brought into view, or, when they are in another Section of the Profile's
 * page (`proposalsHref`, ADR-0024), the Candidate is taken there.
 */
export function AtsScoreButton({ profileId, computed, proposalsHref }: { profileId: string; computed: boolean; proposalsHref?: string | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "computing" | "failed">("idle");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const justComputed = useRef(false);

  useEffect(() => {
    if (refreshing || !justComputed.current) return;
    justComputed.current = false;
    if (!bringActionCardsIntoView() && proposalsHref) router.push(proposalsHref);
  }, [refreshing, proposalsHref, router]);

  async function compute() {
    setState("computing");
    setPrompt(null);
    try {
      const response = await fetch(`/api/profiles/${profileId}/ats-score`, { method: "POST" });
      if (response.status === 402) {
        setPrompt(upgradePromptIn(await response.json()));
        setState("idle");
        return;
      }
      if (!response.ok) throw new Error(`ATS Score failed: ${response.status}`);
      setState("idle");
      justComputed.current = true;
      startRefresh(() => router.refresh());
    } catch {
      setState("failed");
    }
  }

  const busy = state === "computing" || refreshing;
  return (
    <>
      {prompt ? <UpgradePrompt prompt={prompt} /> : null}
      <div className="actions">
        <button className="button button-primary" type="button" onClick={compute} disabled={busy}>
          {busy ? t("atsScore.computing") : t(computed ? "atsScore.recompute" : "atsScore.compute")}
        </button>
      </div>
      {state === "failed" ? (
        <p className="field-error" role="alert">
          {t("atsScore.error")}
        </p>
      ) : null}
    </>
  );
}
