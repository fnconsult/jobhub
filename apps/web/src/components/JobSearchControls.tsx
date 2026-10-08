"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { routes } from "@/routes";

async function post(url: string, body: object): Promise<{ status: number; result: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, result: await response.json().catch(() => ({})) };
  } catch {
    return { status: 0, result: {} };
  }
}

type StartProblem = { prompt: Prompt } | { error: "archived" | "generic" };

/**
 * Asks the AI Coach to search for Job Offers for a Profile, then opens the
 * Job Search's page. When the Plan Quota is used up, shows the Upgrade Prompt.
 */
export function StartJobSearchButton({ profileId, label, className = "button button-primary" }: { profileId: string; label?: string; className?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<StartProblem | null>(null);

  async function start() {
    setWorking(true);
    setProblem(null);
    const { status, result } = await post("/api/job-searches", { profileId });
    if (status === 201 && typeof result.id === "string") {
      router.push(routes.jobSearch(result.id));
      return;
    }
    setWorking(false);
    if (status === 402 && typeof result.prompt === "object" && result.prompt !== null) setProblem({ prompt: result.prompt as Prompt });
    else setProblem({ error: result.error === "archived" ? "archived" : "generic" });
  }

  return (
    <div className="stack">
      <button className={className} type="button" onClick={start} disabled={working}>
        {working ? t("jobSearch.starting") : (label ?? t("jobSearch.start"))}
      </button>
      {problem && "prompt" in problem ? <UpgradePrompt prompt={problem.prompt} /> : null}
      {problem && "error" in problem ? (
        <p className="field-error" role="alert">
          {t(`jobSearch.errors.${problem.error}`)}
        </p>
      ) : null}
    </div>
  );
}

/** Saves one Job Offer a Job Search found as an Application, with the Job Search's Profile, in one click. */
export function SaveSearchResultButton({ jobOfferId, profileId, describedBy }: { jobOfferId: string; profileId: string; describedBy?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    setWorking(true);
    setFailed(false);
    const { status } = await post("/api/applications", { jobOfferId, profileId });
    if (status === 200 || status === 201) {
      // The page then shows the link to the Application instead of this button.
      router.refresh();
      return;
    }
    setWorking(false);
    setFailed(true);
  }

  return (
    <>
      <button className="button button-primary" type="button" onClick={save} disabled={working} aria-describedby={describedBy}>
        {working ? t("jobSearch.saving") : t("jobSearch.save")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("jobSearch.saveError")}
        </p>
      ) : null}
    </>
  );
}

/** While the AI Coach is still searching, reloads the page's data every few seconds. Renders nothing. */
export function RefreshWhileSearching({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
