"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UpgradePrompt, upgradePromptIn } from "@/components/UpgradePrompt";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";

type Problem = { prompt: Prompt } | { error: "archived" | "generic" };

/**
 * Opts the Candidate in to, or out of, a Profile's Job Digest. When their Plan
 * does not include it, shows the Upgrade Prompt.
 */
export function JobDigestToggle({ profileId, subscribed }: { profileId: string; subscribed: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function toggle() {
    setWorking(true);
    setProblem(null);
    let status = 0;
    let body: unknown = {};
    try {
      const response = await fetch(`/api/profiles/${profileId}/job-digest`, { method: subscribed ? "DELETE" : "PUT" });
      status = response.status;
      body = await response.json().catch(() => ({}));
    } catch {
      // Shown as a generic problem below.
    }
    setWorking(false);
    if (status === 200) {
      router.refresh();
      return;
    }
    const prompt = status === 402 ? upgradePromptIn(body) : null;
    setProblem(prompt ? { prompt } : { error: status === 409 ? "archived" : "generic" });
  }

  return (
    <div className="stack">
      <button className={subscribed ? "button" : "button button-primary"} type="button" onClick={toggle} disabled={working}>
        {working ? t("jobDigest.saving") : subscribed ? t("jobDigest.unsubscribe") : t("jobDigest.subscribe")}
      </button>
      {problem && "prompt" in problem ? <UpgradePrompt prompt={problem.prompt} /> : null}
      {problem && "error" in problem ? (
        <p className="field-error" role="alert">
          {problem.error === "archived" ? t("jobDigest.archived") : t("jobDigest.error")}
        </p>
      ) : null}
    </div>
  );
}
