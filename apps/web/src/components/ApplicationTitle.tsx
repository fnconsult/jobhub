"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { MAX_APPLICATION_TITLE_LENGTH } from "@/applications/limits";
import { Icons } from "./icons";
import { GrowingTextarea, InlineNotice, useInlineEdit } from "./InlineEdit";
import { TOP_BAR_RANK, useTopBarAction } from "./top-bar";

/** Sends the Application's new title: null when saved, otherwise what to tell the Candidate. */
async function patchTitle(applicationId: string, title: string): Promise<"required" | "tooLong" | "failed" | null> {
  try {
    const response = await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (response.ok) return null;
    const result = await response.json().catch(() => ({}));
    const code: unknown = Array.isArray(result.errors) ? result.errors[0]?.code : undefined;
    return code === "too_long" ? "tooLong" : code === "required" ? "required" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * An Application's title as its conversation's title in the Top Bar, renamed in place (#1130, ADR-0117): it saves when the
 * Candidate leaves it (or presses Enter), for them only, and the Fiche, Mes candidatures and the Sidebar follow. On a phone,
 * « Renommer » under « … » puts the focus in it. The Job Offer's own title, given back, clears the Candidate's.
 */
export function ApplicationTitle({ applicationId, title }: { applicationId: string; title: string }) {
  // A title changed elsewhere (a Coach proposal applied or undone, then the page's refresh) starts the field afresh.
  return <TitleField key={title} applicationId={applicationId} title={title} />;
}

function TitleField({ applicationId, title }: { applicationId: string; title: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const edit = useInlineEdit({
    saved: title,
    required: true,
    save: async (value) => {
      const problem = await patchTitle(applicationId, value);
      if (problem === "tooLong") return { ok: false, message: t("cvReview.tooLong", { max: MAX_APPLICATION_TITLE_LENGTH }) };
      if (problem === "required") return { ok: false, message: t("cvReview.required") };
      if (problem) return { ok: false, message: t("application.title.error") };
      router.refresh();
      return { ok: true };
    },
  });
  const rename = () => {
    const field = document.getElementById(id);
    if (field instanceof HTMLTextAreaElement) {
      field.focus();
      field.select();
    }
  };
  const icon = useTopBarAction({ id: "rename", rank: TOP_BAR_RANK.rename, label: t("application.title.rename"), icon: Icons.rename, run: rename });
  return (
    <div className="title-field">
      <label className="visually-hidden" htmlFor={id}>
        {t("application.title.label")}
      </label>
      <h1 tabIndex={-1}>
        <GrowingTextarea
          id={id}
          {...edit.field}
          className="inline-edit title-edit title-edit-line"
          rows={1}
          maxLength={MAX_APPLICATION_TITLE_LENGTH}
          title={t("application.title.hint")}
          aria-describedby={edit.notice?.kind === "error" ? `${id}-error` : `${id}-hint`}
          onKeyDown={edit.onKeyDown}
        />
      </h1>
      <span id={`${id}-hint`} hidden>
        {t("application.title.hint")}
      </span>
      {icon}
      <InlineNotice notice={edit.notice} savedLabel={t("application.title.saved")} id={`${id}-error`} />
    </div>
  );
}
