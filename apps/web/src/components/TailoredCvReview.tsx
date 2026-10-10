"use client";

import { DOCUMENT_LANGUAGES, type CvContent, type DocumentLanguage } from "@jobhub/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { APPLICATION_EXPORTS } from "@/application-exports/kinds";
import type { CvChange } from "@/tailored-cv/changes";
import { ApplicationExportForm } from "./ApplicationExportForm";

type Status = "proposing" | "proposed" | "saving" | "saved" | "unavailable" | "masterCvChanged" | "proposalChanged" | "error" | null;

/** The Application's Tailored CV as it comes from the server (dates as strings). */
interface TailoredCv {
  documentLanguage: DocumentLanguage;
  proposal: {
    language: DocumentLanguage;
    /** Names this exact proposal: saving sends it, so only the one reviewed is saved. */
    revision: string;
    content: CvContent;
    questions: { requirement: string; answer: "confirmed" | "declined" | null }[];
    changes: CvChange[];
    matchScore: { master: number; tailored: number };
  } | null;
  saved: { language: DocumentLanguage; content: CvContent; matchScore: { master: number; tailored: number }; savedAt: string | Date } | null;
}

async function send(url: string, method: "POST" | "PATCH", body?: object): Promise<{ tailoredCv?: TailoredCv; status: Status }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (response.ok) return { tailoredCv: (await response.json()) as TailoredCv, status: null };
    if (response.status === 503) return { status: "unavailable" };
    if (response.status === 409) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      return { status: error === "proposal_changed" ? "proposalChanged" : "masterCvChanged" };
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * An Application's Tailored CV: proposed by the AI Coach in the Document
 * Language from the Master CV only (ADR-0006), reviewed by the Candidate change
 * by change against the Master CV, with both Match Scores, then saved on the Application.
 */
export function TailoredCvReview({ applicationId, initial, locale }: { applicationId: string; initial: TailoredCv; locale: string }) {
  const { t } = useTranslation();
  const id = useId();
  const url = `/api/applications/${applicationId}/tailored-cv`;
  const [state, setState] = useState(initial);
  const [language, setLanguage] = useState(initial.documentLanguage);
  const [status, setStatus] = useState<Status>(null);
  const { proposal, saved } = state;

  async function run(next: Promise<{ tailoredCv?: TailoredCv; status: Status }>, done: Status) {
    const result = await next;
    if (!result.tailoredCv) return setStatus(result.status ?? "error");
    setState(result.tailoredCv);
    setStatus(done);
  }

  const propose = () => {
    setStatus("proposing");
    return run(send(url, "POST", { language }), "proposed");
  };
  const answer = (requirement: string, confirmed: boolean) => run(send(url, "PATCH", { requirement, confirmed }), null);
  const save = async () => {
    if (!proposal) return;
    setStatus("saving");
    const result = await send(`${url}/save`, "POST", { revision: proposal.revision });
    if (result.status === "proposalChanged") {
      // Proposed again or answered elsewhere: show that proposal, to be reviewed before it is saved.
      const current = await fetch(url)
        .then((response) => (response.ok ? (response.json() as Promise<TailoredCv>) : null))
        .catch(() => null);
      if (current) setState(current);
      return setStatus("proposalChanged");
    }
    if (!result.tailoredCv) return setStatus(result.status ?? "error");
    setState(result.tailoredCv);
    setStatus("saved");
  };

  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("tailoredCv.title")}</h2>
      <p className="notice">{t("tailoredCv.factsOnly")}</p>

      {saved ? (
        <div className="stack" role="group" aria-labelledby={`${id}-saved`}>
          <h3 id={`${id}-saved`}>{t("tailoredCv.savedTitle")}</h3>
          <p>
            {t("tailoredCv.savedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(saved.savedAt)) })}{" "}
            {t(`tailoredCv.writtenIn.${saved.language}`)}
          </p>
          <ScoreComparison score={saved.matchScore} />
          <CvSummary cv={saved.content} />
          <ApplicationExportForm applicationId={applicationId} document={APPLICATION_EXPORTS[0]} />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor={`${id}-language`}>{t("tailoredCv.languageLabel")}</label>
        <p id={`${id}-language-hint`} className="hint">
          {t("tailoredCv.languageHint")}
        </p>
        <select
          id={`${id}-language`}
          className="input"
          value={language}
          aria-describedby={`${id}-language-hint`}
          onChange={(event) => setLanguage(event.target.value as DocumentLanguage)}
        >
          {DOCUMENT_LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {t(`tailoredDocuments.languages.${option}`)}
            </option>
          ))}
        </select>
      </div>

      {proposal ? (
        <div className="stack" role="group" aria-labelledby={`${id}-proposal`}>
          <h3 id={`${id}-proposal`}>{t("tailoredCv.proposalTitle")}</h3>
          <p className="hint">{t(`tailoredCv.writtenIn.${proposal.language}`)}</p>
          <ScoreComparison score={proposal.matchScore} />

          {proposal.questions.length > 0 ? (
            <div className="stack">
              <h4>{t("tailoredCv.questionsTitle")}</h4>
              <p>{t("tailoredCv.questionsIntro")}</p>
              <ul className="stack">
                {proposal.questions.map((question) => (
                  <li key={question.requirement} className="stack" role="group" aria-label={question.requirement}>
                    <p>{t("tailoredCv.question", { requirement: question.requirement })}</p>
                    <div className="actions">
                      <button className="button" type="button" aria-pressed={question.answer === "confirmed"} onClick={() => answer(question.requirement, true)}>
                        {t("tailoredCv.confirm")}
                      </button>
                      <button className="button" type="button" aria-pressed={question.answer === "declined"} onClick={() => answer(question.requirement, false)}>
                        {t("tailoredCv.decline")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h4>{t("tailoredCv.changesTitle")}</h4>
          {proposal.changes.length > 0 ? (
            <ul className="stack tailored-cv-changes">
              {proposal.changes.map((change, index) => (
                <ChangeItem key={index} change={change} />
              ))}
            </ul>
          ) : (
            <p>{t("tailoredCv.noChanges")}</p>
          )}

          <p id={`${id}-save-hint`} className="hint">
            {t("tailoredCv.saveHint")}
          </p>
          <div className="actions">
            <button className="button button-primary" type="button" onClick={save} disabled={status === "saving"} aria-describedby={`${id}-save-hint`}>
              {status === "saving" ? t("tailoredCv.saving") : t("tailoredCv.save")}
            </button>
            <button className="button" type="button" onClick={propose} disabled={status === "proposing"}>
              {status === "proposing" ? t("tailoredCv.proposing") : t("tailoredCv.proposeAgain")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>{t(saved ? "tailoredCv.noneSinceSaved" : "tailoredCv.none")}</p>
          <button className="button button-primary" type="button" onClick={propose} disabled={status === "proposing"}>
            {status === "proposing" ? t("tailoredCv.proposing") : t("tailoredCv.propose")}
          </button>
        </>
      )}
      <StatusMessage status={status} />
    </section>
  );
}

function ScoreComparison({ score }: { score: { master: number; tailored: number } }) {
  const { t } = useTranslation();
  return (
    <p className="match-score-value" aria-label={t("tailoredCv.scoreLabel", score)}>
      {t("tailoredCv.score", score)}
    </p>
  );
}

function ChangeItem({ change }: { change: CvChange }) {
  const { t } = useTranslation();
  const heading = [t(`tailoredCv.sections.${change.section}`), t(`tailoredCv.kinds.${change.kind}`), change.item].filter(Boolean).join(" · ");
  return (
    <li className="board-card">
      <p className="cv-entry">{heading}</p>
      {change.kind === "rephrased" || change.kind === "reordered" ? (
        <dl className="tailored-cv-compare">
          <div>
            <dt>{t("tailoredCv.master")}</dt>
            <dd className="cv-text">{change.master || t("tailoredCv.empty")}</dd>
          </div>
          <div>
            <dt>{t("tailoredCv.tailored")}</dt>
            <dd className="cv-text">{change.tailored || t("tailoredCv.empty")}</dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
}

/** The saved Tailored CV, read-only. */
function CvSummary({ cv }: { cv: CvContent }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="cv">
      {cv.headline ? <p className="cv-name">{cv.headline}</p> : null}
      {cv.summary ? <p className="cv-text">{cv.summary}</p> : null}
      {cv.experience.length > 0 ? (
        <ul className="cv-list" aria-label={t("tailoredCv.sections.experience")}>
          {cv.experience.map((job, index) => (
            <li key={index}>
              <p className="cv-entry">{[job.title, job.employer, job.period].filter(Boolean).join(" · ")}</p>
              {job.description ? <p className="cv-text">{job.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {cv.education.length > 0 ? (
        <>
          <p id={`${id}-education`} className="cv-entry">
            {t("tailoredCv.sections.education")}
          </p>
          <ul className="cv-list" aria-labelledby={`${id}-education`}>
            {cv.education.map((item, index) => (
              <li key={index}>{[item.degree, item.institution, item.year].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </>
      ) : null}
      {cv.skills.length > 0 ? <p>{t("tailoredCv.skillsLine", { skills: cv.skills.join(", ") })}</p> : null}
      {cv.languages.length > 0 ? (
        <>
          <p id={`${id}-languages`} className="cv-entry">
            {t("tailoredCv.sections.languages")}
          </p>
          <ul className="cv-list" aria-labelledby={`${id}-languages`}>
            {cv.languages.map((item, index) => (
              <li key={index}>{[item.name, item.level].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function StatusMessage({ status }: { status: Status }) {
  const { t } = useTranslation();
  if (status === "proposed" || status === "saved") return <p role="status">{t(`tailoredCv.${status}`)}</p>;
  if (status === "unavailable" || status === "masterCvChanged" || status === "proposalChanged" || status === "error")
    return (
      <p className="field-error" role="alert">
        {t(`tailoredCv.${status}`)}
      </p>
    );
  return null;
}
