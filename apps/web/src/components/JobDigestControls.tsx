"use client";

import type { JobDigestFrequency } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { UpgradePrompt, upgradePromptIn } from "@/components/UpgradePrompt";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";

type Problem = { prompt: Prompt } | { error: "archived" | "generic" };
type Frequency = Exclude<JobDigestFrequency, "none">;

const FREQUENCIES: Frequency[] = ["weekly", "daily"];

/**
 * The Job Digest of a Profile: how often the Candidate wants it (daily or
 * weekly), and opting in or out. The server refuses a frequency above the
 * Plan's, and a Plan without the Job Digest: the Upgrade Prompt says why.
 */
export function JobDigestControls({
  profileId,
  subscribed,
  chosenFrequency,
  planFrequency,
}: {
  profileId: string;
  subscribed: boolean;
  chosenFrequency: Frequency | null;
  planFrequency: JobDigestFrequency;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const name = useId();
  const [frequency, setFrequency] = useState<Frequency>(chosenFrequency ?? (planFrequency === "daily" ? "daily" : "weekly"));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function send(method: "PUT" | "DELETE") {
    setWorking(true);
    setProblem(null);
    let status = 0;
    let body: unknown = {};
    try {
      const response = await fetch(`/api/profiles/${profileId}/job-digest`, {
        method,
        ...(method === "PUT" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ frequency }) } : {}),
      });
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
      <fieldset className="fieldset">
        <legend>{t("jobDigest.frequencyLegend")}</legend>
        {FREQUENCIES.map((option) => (
          <div key={option} className="choice">
            <input
              type="radio"
              id={`${name}-${option}`}
              name={name}
              value={option}
              checked={frequency === option}
              onChange={() => setFrequency(option)}
              disabled={working}
            />
            <label htmlFor={`${name}-${option}`}>{t(`jobDigest.frequencyOptions.${option}`)}</label>
          </div>
        ))}
      </fieldset>
      <div className="actions">
        {subscribed ? (
          <>
            <button className="button button-primary" type="button" onClick={() => send("PUT")} disabled={working || frequency === chosenFrequency}>
              {working ? t("jobDigest.saving") : t("jobDigest.saveFrequency")}
            </button>
            <button className="button" type="button" onClick={() => send("DELETE")} disabled={working}>
              {t("jobDigest.unsubscribe")}
            </button>
          </>
        ) : (
          <button className="button button-primary" type="button" onClick={() => send("PUT")} disabled={working}>
            {working ? t("jobDigest.saving") : t("jobDigest.subscribe")}
          </button>
        )}
      </div>
      {problem && "prompt" in problem ? <UpgradePrompt prompt={problem.prompt} /> : null}
      {problem && "error" in problem ? (
        <p className="field-error" role="alert">
          {problem.error === "archived" ? t("jobDigest.archived") : t("jobDigest.error")}
        </p>
      ) : null}
    </div>
  );
}
