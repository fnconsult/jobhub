"use client";

import { CONTRACT_TYPES, REMOTE_WORK_OPTIONS, type SearchCriteria } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { GrowingTextarea, InlineNotice, useInlineEdit, type InlineSaveResult } from "./InlineEdit";
import { criteriaFieldsOf, searchCriteriaInput, type CriteriaFields } from "./SearchCriteriaFields";

type Problem = ProfileFieldError | "archived" | "failed";

/** Sends one change of the Profile: null when saved, otherwise the problem with `field`. */
async function patchProfile(profileId: string, body: object, field: string): Promise<Problem | null> {
  try {
    const response = await fetch(`/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const result = await response.json().catch(() => ({}));
    const errors: ProfileFieldError[] = Array.isArray(result.errors) ? result.errors : [];
    return errors.find((each) => each.field === field) ?? errors[0] ?? (result.error === "archived" ? "archived" : "failed");
  } catch {
    return "failed";
  }
}

/** What to tell the Candidate about a refused change. */
function useProblemMessage() {
  const { t } = useTranslation();
  return (problem: Problem, maxLength?: number): string => {
    if (problem === "archived") return t("searchCriteriaEditor.archived");
    if (problem === "failed") return t("profileActions.error");
    if (problem.code === "too_long") return t("cvReview.tooLong", { max: maxLength });
    return problem.code === "required" ? t("cvReview.required") : t("cvReview.invalidValue");
  };
}

/**
 * The Profile's name as the page title, edited in place: it saves when the
 * Candidate leaves it (or presses Enter), and the sidebar follows.
 */
export function ProfileTitle({ profileId, name }: { profileId: string; name: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const messageOf = useProblemMessage();
  const edit = useInlineEdit({
    saved: name,
    required: true,
    save: async (value) => {
      const problem = await patchProfile(profileId, { name: value }, "name");
      if (problem) return { ok: false, message: messageOf(problem, PROFILE_NAME_MAX_LENGTH) };
      router.refresh();
      return { ok: true };
    },
  });
  return (
    <div className="title-field">
      <label className="visually-hidden" htmlFor={id}>
        {t("profileActions.name")}
      </label>
      <h1 tabIndex={-1}>
        <GrowingTextarea
          id={id}
          {...edit.field}
          className="inline-edit title-edit"
          rows={1}
          maxLength={PROFILE_NAME_MAX_LENGTH}
          aria-describedby={edit.notice?.kind === "error" ? `${id}-error` : undefined}
          onKeyDown={edit.onKeyDown}
        />
      </h1>
      <InlineNotice notice={edit.notice} savedLabel={t("profilePage.nameSaved")} id={`${id}-error`} />
    </div>
  );
}

/**
 * An active Profile's Search Criteria as a property list, each value edited in
 * place and saved on change. Changing them does not rename the Profile.
 */
export function SearchCriteriaProperties({ profileId, searchCriteria }: { profileId: string; searchCriteria: SearchCriteria }) {
  const { t } = useTranslation();
  const router = useRouter();
  const initial = criteriaFieldsOf(searchCriteria);
  // The criteria as last saved: each field saves them all with its own value changed.
  const saved = useRef<CriteriaFields>(initial);
  const messageOf = useProblemMessage();
  const save =
    (field: keyof CriteriaFields, maxLength?: number) =>
    async (value: string): Promise<InlineSaveResult> => {
      const next = { ...saved.current, [field]: value };
      const problem = await patchProfile(profileId, { searchCriteria: searchCriteriaInput(next) }, `searchCriteria.${field}`);
      if (problem) return { ok: false, message: messageOf(problem, maxLength) };
      saved.current = next;
      router.refresh();
      return { ok: true };
    };
  const notSpecified: [string, string] = ["", t("cvReview.notSpecified")];
  const properties: (Omit<PropertyProps, "saved" | "save"> & { field: keyof CriteriaFields })[] = [
    { field: "targetRole", label: t("cvReview.targetRole"), required: true, maxLength: PROFILE_NAME_MAX_LENGTH },
    { field: "location", label: t("cvReview.location"), required: true },
    { field: "minSalary", label: t("cvReview.minSalary"), numeric: true },
    {
      field: "contractType",
      label: t("cvReview.contractType"),
      options: [notSpecified, ...CONTRACT_TYPES.map((option): [string, string] => [option, t(`cvReview.contractTypes.${option}`)])],
    },
    {
      field: "remoteWork",
      label: t("cvReview.remoteWork"),
      options: [notSpecified, ...REMOTE_WORK_OPTIONS.map((option): [string, string] => [option, t(`cvReview.remoteWorkOptions.${option}`)])],
      hint: t("searchCriteriaEditor.hint"),
    },
  ];
  return (
    <div role="group" aria-label={t("cvReview.searchCriteria")}>
      <dl className="props">
        {properties.map(({ field, ...property }) => (
          <Property key={field} {...property} saved={initial[field]} save={save(field, property.maxLength)} />
        ))}
      </dl>
    </div>
  );
}

type PropertyProps = {
  label: string;
  saved: string;
  save: (value: string) => Promise<InlineSaveResult>;
  required?: boolean;
  numeric?: boolean;
  maxLength?: number;
  options?: [string, string][];
  hint?: string;
};

function Property(props: PropertyProps) {
  const { t } = useTranslation();
  const id = useId();
  const edit = useInlineEdit({ saved: props.saved, required: props.required ?? false, save: props.save });
  const described = [props.hint ? `${id}-hint` : "", edit.notice?.kind === "error" ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <dt>
        <label htmlFor={id}>{props.label}</label>
      </dt>
      <dd>
        {props.options ? (
          <select id={id} {...edit.select} aria-describedby={described}>
            {props.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type="text"
            {...edit.field}
            required={props.required}
            maxLength={props.maxLength}
            inputMode={props.numeric ? "numeric" : undefined}
            aria-describedby={described}
            onKeyDown={edit.onKeyDown}
          />
        )}
        <InlineNotice notice={edit.notice} savedLabel={t("profilePage.criteriaSaved")} id={`${id}-error`} />
        {props.hint ? (
          <span className="hint" id={`${id}-hint`}>
            {props.hint}
          </span>
        ) : null}
      </dd>
    </>
  );
}
