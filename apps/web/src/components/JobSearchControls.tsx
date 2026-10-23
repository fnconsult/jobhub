"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
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
 * `icon` is decoration beside the label (see icons.tsx).
 */
export function StartJobSearchButton({
  profileId,
  label,
  className = "button button-primary",
  icon,
}: {
  profileId: string;
  label?: string;
  className?: string;
  icon?: ReactNode;
}) {
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
        {icon}
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

type StartAllFailure = { profileId: string; profile: string; reason: "quota" | "archived" | "generic" };

/**
 * Starts one Job Search for each of `profiles` (the Candidate's active Profiles), one after
 * the other, each counting one against the Plan Quota as from a Profile's page; then stays on
 * the page, which shows them running. Says how many started and, by name, each Profile left
 * without one and why; the first Upgrade Prompt a used-up Plan Quota gave is shown once.
 */
export function StartAllJobSearchesButton({ profiles, icon }: { profiles: { id: string; name: string }[]; icon?: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ started: number; failures: StartAllFailure[]; prompt: Prompt | null } | null>(null);

  async function start() {
    setWorking(true);
    setOutcome(null);
    let started = 0;
    let prompt: Prompt | null = null;
    const failures: StartAllFailure[] = [];
    for (const profile of profiles) {
      const { status, result } = await post("/api/job-searches", { profileId: profile.id });
      if (status === 201) {
        started += 1;
        continue;
      }
      const quota = status === 402;
      if (quota && !prompt && typeof result.prompt === "object" && result.prompt !== null) prompt = result.prompt as Prompt;
      failures.push({ profileId: profile.id, profile: profile.name, reason: quota ? "quota" : result.error === "archived" ? "archived" : "generic" });
    }
    setOutcome({ started, failures, prompt });
    setWorking(false);
    if (started > 0) router.refresh();
  }

  return (
    <div className="stack">
      <button className="button button-primary" type="button" onClick={start} disabled={working}>
        {icon}
        {working ? t("jobSearchesPage.startingAll") : t("jobSearchesPage.startAll", { count: profiles.length })}
      </button>
      <div role="status">{outcome && outcome.started > 0 ? <p>{t("jobSearchesPage.startedAll", { count: outcome.started })}</p> : null}</div>
      {outcome && outcome.failures.length > 0 ? (
        <ul className="field-error" role="alert">
          {outcome.failures.map((failure) => (
            <li key={failure.profileId}>{t("jobSearchesPage.failedFor", { profile: failure.profile, reason: t(`jobSearchesPage.failureReasons.${failure.reason}`) })}</li>
          ))}
        </ul>
      ) : null}
      {outcome?.prompt ? <UpgradePrompt prompt={outcome.prompt} /> : null}
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

/**
 * Stops the Candidate's Job Search still searching (#331): the worker stops it between two steps and keeps the Job
 * Offers found until then; the page, refreshing itself, then shows it stopped.
 */
export function StopJobSearchButton({ jobSearchId }: { jobSearchId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);

  async function stop() {
    setStopping(true);
    setFailed(false);
    const { status } = await post(`/api/job-searches/${encodeURIComponent(jobSearchId)}/stop`, {});
    // 409: it ended meanwhile; the page shows how.
    if (status === 202 || status === 409) {
      router.refresh();
      return;
    }
    setStopping(false);
    setFailed(true);
  }

  return (
    <div className="stack">
      <button className="button" type="button" onClick={stop} disabled={stopping}>
        {stopping ? t("jobSearch.stopping") : t("jobSearch.stop")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("jobSearch.stopError")}
        </p>
      ) : null}
    </div>
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
