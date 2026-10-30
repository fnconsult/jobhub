"use client";

import type { MasterCvContent } from "@jobhub/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { isDirty, nextDraft, saveRequest, startDraft, type CvDocumentFields } from "@/profiles/master-cv-draft";
import { buttonClass } from "@/design/button-class";
import { routes } from "@/routes";
import { HelpText } from "./HelpTerm";
import { GrowingTextarea } from "./InlineEdit";
import { SkillTags } from "./SkillTags";

/** The skills typed in the skills field, one per line, as its tags show them. */
const skillsOf = (text: string) =>
  text
    .split("\n")
    .map((skill) => skill.trim())
    .filter(Boolean);

/** A job's mark: the first letters of its employer's first two words (« Groupe Sorelis » → « GS »). */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

/**
 * A Profile's Master CV as a document on the Profile page, in cards (#468): its summary with its version, its
 * skills as tags over their field, its jobs. Its title, summary,
 * job descriptions and skills are edited in place. Edits accumulate; "Enregistrer
 * la version N" saves them as one new version based on the version edited
 * (ADR-0012), "Annuler" drops them. The rest of the CV (contact details, jobs,
 * education, languages) is edited in the full editor.
 */
export function MasterCvDocument(props: { profileId: string; version: number; savedOn: string | null; content: MasterCvContent }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [draft, dispatch] = useReducer(nextDraft, startDraft(props.version, props.content));
  const [cancelled, setCancelled] = useState(false);
  const dirty = isDirty(draft);
  const { fields, status } = draft;
  const { experience } = draft.saved;

  // A version the page brings after a refresh (a save here, an accepted ATS Fix).
  useEffect(() => {
    dispatch({ type: "loaded", version: props.version, content: props.content });
  }, [props.version, props.content]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || status.kind === "saving") return;
    setCancelled(false);
    dispatch({ type: "save" });
    try {
      const response = await fetch(`/api/profiles/${props.profileId}/master-cv`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saveRequest(draft)),
      });
      const body = await response.json().catch(() => ({}));
      dispatch({ type: "answered", status: response.status, body });
      if (response.ok) router.refresh();
    } catch {
      dispatch({ type: "failed" });
    }
  }

  const edit = (changes: Partial<CvDocumentFields>) => {
    setCancelled(false);
    dispatch({ type: "edit", changes });
  };
  const showBar = dirty || status.kind === "conflict" || status.kind === "invalid" || status.kind === "failed";

  return (
    <section className="section" aria-labelledby="master-cv-title">
      <div className="section-head">
        <h2 id="master-cv-title">{t("profile.masterCv")}</h2>
      </div>
      <form className="cv-doc cv-cards" onSubmit={save} noValidate>
        <div className="cv-card">
          <div className="cv-card-head">
            <h3>{t("profilePage.cards.summary")}</h3>
            <p className="cv-card-meta">
              {props.savedOn ? t("profilePage.cvVersion", { version: props.version, date: props.savedOn }) : t("profile.version", { version: props.version })}
            </p>
          </div>
          <div className="doc-block">
            <label htmlFor="cv-headline">{t("cvReview.headline")}</label>
            <input id="cv-headline" className="inline-edit" value={fields.headline} onChange={(e) => edit({ headline: e.target.value })} />
          </div>
          <div className="doc-block">
            <label htmlFor="cv-summary">{t("cvReview.summary")}</label>
            <GrowingTextarea id="cv-summary" className="inline-edit" rows={4} value={fields.summary} onChange={(e) => edit({ summary: e.target.value })} />
          </div>
        </div>
        <div className="cv-card">
          <div className="cv-card-head">
            <h3>{t("profilePage.cards.skills")}</h3>
          </div>
          <SkillTags skills={skillsOf(fields.skills)} label={t("profilePage.cards.skills")} />
          <div className="doc-block">
            <label htmlFor="cv-skills">{t("profilePage.skills")}</label>
            <GrowingTextarea id="cv-skills" className="inline-edit" rows={6} value={fields.skills} onChange={(e) => edit({ skills: e.target.value })} />
          </div>
        </div>
        <div className="cv-card" role="group" aria-labelledby="cv-experience">
          <div className="cv-card-head">
            <h3 id="cv-experience">{t("cvReview.experience")}</h3>
            <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.editMasterCv(props.profileId)}>
              {t("profile.editMasterCv")}
            </Link>
          </div>
          {experience.map((job, index) => {
            const name = [job.title, job.employer].filter(Boolean).join(" · ");
            return (
              <div className="job cv-job" key={index}>
                <span className="cv-job-mark" aria-hidden>
                  {initialsOf(job.employer || job.title)}
                </span>
                <div className="job-head">
                  <strong>{name}</strong>
                  <span>{[job.period, job.location].filter(Boolean).join(" · ")}</span>
                </div>
                <label className="visually-hidden" htmlFor={`cv-job-${index}`}>
                  {t("profilePage.jobDescription", { job: name })}
                </label>
                <GrowingTextarea
                  id={`cv-job-${index}`}
                  className="inline-edit"
                  rows={3}
                  value={fields.descriptions[index] ?? ""}
                  onChange={(e) => edit({ descriptions: fields.descriptions.map((each, i) => (i === index ? e.target.value : each)) })}
                />
              </div>
            );
          })}
          <p className="cv-card-meta">
            <HelpText terms={{ masterCv: t("helpTerms.words.masterCv") }}>{t("profilePage.fullEditorHint")}</HelpText>
          </p>
          <div className="btn-row">
            <Link className="button" href={routes.masterCvVersions(props.profileId)}>
              {t("profile.versionHistory")}
            </Link>
          </div>
        </div>

        {status.kind === "saved" ? (
          <p className="notice" role="status">
            {t("profilePage.savedVersion", { version: status.version })}
          </p>
        ) : cancelled ? (
          <p className="notice" role="status">
            {t("profilePage.cancelled")}
          </p>
        ) : null}

        {showBar ? (
          <div className="savebar" role="region" aria-label={t("profilePage.savebarLabel")}>
            {status.kind === "conflict" || status.kind === "invalid" || status.kind === "failed" ? (
              <p className="field-error" role="alert">
                {status.kind === "conflict"
                  ? t("cvEditor.conflict", { version: status.currentVersion })
                  : t(status.kind === "invalid" ? "cvEditor.invalid" : "cvEditor.error")}
              </p>
            ) : (
              <p>{t("profilePage.unsaved")}</p>
            )}
            <div className="btn-row">
              <button
                className="button button-quiet"
                type="button"
                disabled={status.kind === "saving"}
                onClick={() => {
                  dispatch({ type: "cancel" });
                  setCancelled(true);
                }}
              >
                {t("profilePage.cancel")}
              </button>
              <button className="button button-primary" type="submit" disabled={!dirty || status.kind === "saving"}>
                {status.kind === "saving" ? t("cvEditor.saving") : t("profilePage.saveVersion", { version: draft.nextVersion })}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
