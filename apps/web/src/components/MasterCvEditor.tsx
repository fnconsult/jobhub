"use client";

import type { MasterCvContent } from "@jobhub/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/routes";
import { MasterCvFields } from "./MasterCvFields";

type Outcome = { kind: "editing" } | { kind: "saving" } | { kind: "conflict"; currentVersion: number } | { kind: "invalid" } | { kind: "failed" };

/**
 * Editing a Profile's Master CV. Saving creates the next version; if another
 * save landed since `version` was loaded, nothing is overwritten.
 */
export function MasterCvEditor(props: { profileId: string; version: number; content: MasterCvContent }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [content, setContent] = useState(props.content);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "editing" });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome({ kind: "saving" });
    try {
      const response = await fetch(`/api/profiles/${props.profileId}/master-cv`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ basedOnVersion: props.version, content }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        router.push(routes.profile(props.profileId));
        router.refresh();
        return;
      }
      if (response.status === 409 && typeof body.currentVersion === "number") setOutcome({ kind: "conflict", currentVersion: body.currentVersion });
      else setOutcome({ kind: response.status === 400 ? "invalid" : "failed" });
    } catch {
      setOutcome({ kind: "failed" });
    }
  }

  return (
    <form className="stack review" onSubmit={save} noValidate>
      <MasterCvFields value={content} onChange={setContent} />
      {outcome.kind === "conflict" ? (
        <p className="notice" role="alert">
          {t("cvEditor.conflict", { version: outcome.currentVersion })}
        </p>
      ) : null}
      {outcome.kind === "invalid" || outcome.kind === "failed" ? (
        <p className="notice" role="alert">
          {t(outcome.kind === "invalid" ? "cvEditor.invalid" : "cvEditor.error")}
        </p>
      ) : null}
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={outcome.kind === "saving"}>
          {outcome.kind === "saving" ? t("cvEditor.saving") : t("cvEditor.save")}
        </button>
        <Link className="button" href={routes.profile(props.profileId)}>
          {t("cvEditor.cancel")}
        </Link>
      </div>
    </form>
  );
}
