"use client";

import type { SearchCriteria } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { criteriaFieldsOf, SearchCriteriaFields, searchCriteriaInput, useSearchCriteriaLabels, type CriteriaFields } from "./SearchCriteriaFields";

type Outcome = { saved: true } | { errors: ProfileFieldError[] } | { problem: "archived" | "failed" };

/**
 * Editing an active Profile's Search Criteria. The Profile keeps its name: the
 * Candidate renames it separately.
 */
export function SearchCriteriaEditor({ profileId, searchCriteria }: { profileId: string; searchCriteria: SearchCriteria }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [criteria, setCriteria] = useState<CriteriaFields>(() => criteriaFieldsOf(searchCriteria));
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const fieldLabels = useSearchCriteriaLabels();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setOutcome(null);
    try {
      const response = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ searchCriteria: searchCriteriaInput(criteria) }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setOutcome({ saved: true });
        router.refresh();
      } else if (Array.isArray(body.errors)) setOutcome({ errors: body.errors });
      else setOutcome({ problem: body.error === "archived" ? "archived" : "failed" });
    } catch {
      setOutcome({ problem: "failed" });
    } finally {
      setSaving(false);
    }
  }

  const errors = outcome && "errors" in outcome ? outcome.errors : [];
  const invalidFields = [...new Set(errors.map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <form className="stack" onSubmit={save} noValidate aria-labelledby="search-criteria-title">
      <h2 id="search-criteria-title">{t("cvReview.searchCriteria")}</h2>
      <p className="hint">{t("searchCriteriaEditor.hint")}</p>
      <SearchCriteriaFields value={criteria} onChange={(changes) => setCriteria((current) => ({ ...current, ...changes }))} errors={errors} />
      {invalidFields.length > 0 ? (
        <p className="notice" role="alert">
          {t("cvReview.invalid", { fields: invalidFields.join(", ") })}
        </p>
      ) : null}
      {outcome && "problem" in outcome ? (
        <p className="notice" role="alert">
          {t(outcome.problem === "archived" ? "searchCriteriaEditor.archived" : "profileActions.error")}
        </p>
      ) : null}
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={saving}>
          {saving ? t("profileActions.working") : t("searchCriteriaEditor.save")}
        </button>
      </div>
      {outcome && "saved" in outcome ? <p role="status">{t("searchCriteriaEditor.saved")}</p> : null}
    </form>
  );
}
