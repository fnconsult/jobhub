"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";

/** Computes the Profile's ATS Score (counted against the Plan Quota), then shows it and the fixes proposed. */
export function AtsScoreButton({ profileId, computed }: { profileId: string; computed: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "computing" | "failed">("idle");
  const [prompt, setPrompt] = useState<Prompt | null>(null);

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
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      {prompt ? <UpgradePrompt prompt={prompt} /> : null}
      <div className="actions">
        <button className="button button-primary" type="button" onClick={compute} disabled={state === "computing"}>
          {state === "computing" ? t("atsScore.computing") : t(computed ? "atsScore.recompute" : "atsScore.compute")}
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
