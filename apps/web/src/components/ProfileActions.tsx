"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { ProfileFieldError } from "@/profiles";
import { copyName, PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { routes } from "@/routes";
import { TextField } from "./form-fields";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";

type Action = "rename" | "duplicate" | "archive";
type Outcome = {
  action: Action;
  errors?: ProfileFieldError[];
  problem?: "plan_quota_reached" | "failed";
  /** When the Plan Quota refused: what the Plan allows and which Plan allows more. */
  upgradePrompt?: Prompt | null;
  done?: boolean;
};

/** Rename, duplicate, archive or restore one Profile. */
export function ProfileActions({ profile }: { profile: { id: string; name: string; archived: boolean } }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [duplicateName, setDuplicateName] = useState(() => copyName(profile.name, (name) => t("profiles.copyOf", { name })));
  const [working, setWorking] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  /** Sends one change; returns the response body when it succeeded. */
  async function send(action: Action, url: string, method: "PATCH" | "POST", body: object): Promise<{ id: string } | null> {
    setWorking(action);
    setOutcome(null);
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      if (Array.isArray(result.errors)) setOutcome({ action, errors: result.errors });
      else if (result.error === "plan_quota_reached") setOutcome({ action, problem: "plan_quota_reached", upgradePrompt: upgradePromptIn(result) });
      else setOutcome({ action, problem: "failed" });
    } catch {
      setOutcome({ action, problem: "failed" });
    } finally {
      setWorking(null);
    }
    return null;
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send("rename", `/api/profiles/${profile.id}`, "PATCH", { name })) {
      setOutcome({ action: "rename", done: true });
      setDuplicateName(copyName(name, (copied) => t("profiles.copyOf", { name: copied })));
      router.refresh();
    }
  }

  async function duplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await send("duplicate", `/api/profiles/${profile.id}/duplicate`, "POST", { name: duplicateName });
    if (created) router.push(routes.profile(created.id));
  }

  async function toggleArchived() {
    if (await send("archive", `/api/profiles/${profile.id}`, "PATCH", { archived: !profile.archived })) router.refresh();
  }

  const nameError = (action: Action) => (outcome?.action === action ? outcome.errors?.find((error) => error.field === "name") : undefined);
  const problem = (action: Action) =>
    outcome?.action === action && outcome.upgradePrompt ? (
      <UpgradePrompt prompt={outcome.upgradePrompt} />
    ) : outcome?.action === action && outcome.problem ? (
      <p className="notice" role="alert">
        {t(outcome.problem === "plan_quota_reached" ? "profiles.quotaReached" : "profileActions.error")}
      </p>
    ) : null;

  const renameError = nameError("rename");
  const duplicateError = nameError("duplicate");
  const renameProblem = problem("rename");
  const duplicateProblem = problem("duplicate");
  const archiveProblem = problem("archive");

  return (
    <section className="stack" aria-labelledby="profile-actions">
      <h2 id="profile-actions">{t("profileActions.title")}</h2>

      <form className="stack" onSubmit={rename} noValidate>
        <TextField label={t("profileActions.name")} value={name} onChange={setName} error={renameError} maxLength={PROFILE_NAME_MAX_LENGTH} required />
        <button className="button" type="submit" disabled={working !== null}>
          {working === "rename" ? t("profileActions.working") : t("profileActions.rename")}
        </button>
        {outcome?.action === "rename" && outcome.done ? <p role="status">{t("profileActions.renamed")}</p> : null}
        {renameProblem}
      </form>

      <form className="stack" onSubmit={duplicate} noValidate>
        <TextField
          label={t("profileActions.duplicateName")}
          hint={t("profileActions.duplicateHint")}
          value={duplicateName}
          onChange={setDuplicateName}
          error={duplicateError}
          maxLength={PROFILE_NAME_MAX_LENGTH}
          required
        />
        <button className="button" type="submit" disabled={working !== null}>
          {working === "duplicate" ? t("profileActions.working") : t("profileActions.duplicate")}
        </button>
        {duplicateProblem}
      </form>

      <div className="stack">
        {profile.archived ? null : <p className="hint">{t("profileActions.archiveHint")}</p>}
        <button className="button" type="button" onClick={toggleArchived} disabled={working !== null}>
          {working === "archive" ? t("profileActions.working") : t(profile.archived ? "profileActions.restore" : "profileActions.archive")}
        </button>
        {archiveProblem}
      </div>
    </section>
  );
}
