"use client";

import type { CvContent, DocumentLanguage, Provenance } from "@jobhub/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { APPLICATION_EXPORTS } from "@/application-exports/kinds";
import type { CvChange } from "@/tailored-cv/changes";
import { ApplicationExportForm } from "./ApplicationExportForm";
import { LiveActionStatus, useLiveAction } from "./LiveAction";
import { ProvenanceLine } from "./ProvenanceLine";
import { SkillTags } from "@/components/SkillTags";

type Status = "proposing" | "proposed" | "saving" | "saved" | "unavailable" | "masterCvChanged" | "proposalChanged" | "error" | null;

/** The Application's Tailored CV as it comes from the server (dates as strings). */
export interface TailoredCv {
  documentLanguage: DocumentLanguage;
  proposal: {
    language: DocumentLanguage;
    /** Names this exact proposal: saving sends it, so only the one reviewed is saved. */
    revision: string;
    content: CvContent;
    questions: { requirement: string; answer: "confirmed" | "declined" | null }[];
    changes: CvChange[];
    /** The Job Offer's words were checked against the Master CV through a translation. */
    offerWordingTranslated?: boolean;
    matchScore: { master: number; tailored: number };
    /** What served it, and when (#334), for the line under it. */
    provenance?: Provenance | null;
    proposedAt?: string | Date;
  } | null;
  saved: { language: DocumentLanguage; content: CvContent; matchScore: { master: number; tailored: number }; savedAt: string | Date; provenance?: Provenance | null } | null;
}

/** What a failed request means for the Candidate. */
function statusOf(status: number, error: unknown): Status {
  if (status === 503) return "unavailable";
  if (status === 409) return error === "proposal_changed" ? "proposalChanged" : "masterCvChanged";
  return "error";
}

async function send(url: string, method: "POST" | "PATCH", body?: object): Promise<{ tailoredCv?: TailoredCv; status: Status }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (response.ok) return { tailoredCv: (await response.json()) as TailoredCv, status: null };
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    return { status: statusOf(response.status, error) };
  } catch {
    return { status: "error" };
  }
}

/**
 * Whether the Candidate accepted a change: what they chose, else accepted, unless it takes
 * words from the Job Offer the Master CV lacks, which waits for an explicit accept (ADR-0006, #161).
 */
const decisionOf = (change: CvChange, decisions: Record<string, boolean>): boolean | null => decisions[change.id] ?? (change.fromOffer?.length ? null : true);

/**
 * An Application's Tailored CV: proposed by the AI Coach in the Document
 * Language (`language`, chosen beside it) from the Master CV only (ADR-0006),
 * reviewed by the Candidate change by change against the Master CV, with both
 * Match Scores, then saved on the Application with only the changes they
 * accepted (#161). The tab of the Application's Tailored Documents that holds it names it.
 */
export function TailoredCvReview({ applicationId, initial, language, locale }: { applicationId: string; initial: TailoredCv; language: DocumentLanguage; locale: string }) {
  const { t } = useTranslation();
  const id = useId();
  const url = `/api/applications/${applicationId}/tailored-cv`;
  const [state, setState] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  // Proposing runs live, each step shown, and the Candidate can stop it (#334).
  const action = useLiveAction();
  /** The Candidate's accept (true) or reject (false) of each change of the proposal under review, by id. */
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const { proposal, saved } = state;
  const awaitingAccept = proposal?.changes.some((change) => decisionOf(change, decisions) === null) ?? false;

  async function run(next: Promise<{ tailoredCv?: TailoredCv; status: Status }>, done: Status) {
    const result = await next;
    if (!result.tailoredCv) return setStatus(result.status ?? "error");
    setState(result.tailoredCv);
    setStatus(done);
  }

  const propose = async () => {
    setStatus("proposing");
    const outcome = await action.run<TailoredCv>(url, { language });
    // Stopped: nothing was kept, the proposal shown stays; the stopped line says so.
    if ("stopped" in outcome) return setStatus(null);
    if (!outcome.ok) return setStatus(statusOf(outcome.status, outcome.body.error));
    setState(outcome.body);
    setStatus("proposed");
    // Another proposal: its changes are reviewed afresh.
    setDecisions({});
  };
  const decide = (change: CvChange, accepted: boolean) => setDecisions((current) => ({ ...current, [change.id]: accepted }));
  const answer = (requirement: string, confirmed: boolean) => run(send(url, "PATCH", { requirement, confirmed }), null);
  const save = async () => {
    if (!proposal) return;
    setStatus("saving");
    const accepted = proposal.changes.filter((change) => decisionOf(change, decisions) === true).map((change) => change.id);
    const result = await send(`${url}/save`, "POST", { revision: proposal.revision, accepted });
    if (result.status === "proposalChanged") {
      // Proposed again or answered elsewhere: show that proposal, to be reviewed before it is saved.
      const current = await fetch(url)
        .then((response) => (response.ok ? (response.json() as Promise<TailoredCv>) : null))
        .catch(() => null);
      if (current) setState(current);
      setDecisions({});
      return setStatus("proposalChanged");
    }
    if (!result.tailoredCv) return setStatus(result.status ?? "error");
    setState(result.tailoredCv);
    setStatus("saved");
  };

  return (
    <div className="stack">
      <p className="notice">{t("tailoredCv.factsOnly")}</p>

      {saved ? (
        <div className="stack" role="group" aria-labelledby={`${id}-saved`}>
          <h3 id={`${id}-saved`}>{t("tailoredCv.savedTitle")}</h3>
          <p>
            {t("tailoredCv.savedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(saved.savedAt)) })}{" "}
            {t(`tailoredCv.writtenIn.${saved.language}`)}
          </p>
          <ProvenanceLine provenance={saved.provenance ?? null} at={new Date(saved.savedAt).toISOString()} />
          <ScoreComparison score={saved.matchScore} />
          <CvSummary cv={saved.content} />
          <ApplicationExportForm applicationId={applicationId} document={APPLICATION_EXPORTS[0]} />
        </div>
      ) : null}

      {proposal ? (
        <div className="stack" role="group" aria-labelledby={`${id}-proposal`}>
          <h3 id={`${id}-proposal`}>{t("tailoredCv.proposalTitle")}</h3>
          <p className="hint">{t(`tailoredCv.writtenIn.${proposal.language}`)}</p>
          {proposal.proposedAt ? <ProvenanceLine provenance={proposal.provenance ?? null} at={new Date(proposal.proposedAt).toISOString()} /> : null}
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
          {proposal.offerWordingTranslated ? <p className="hint">{t("tailoredCv.offerWordingTranslated")}</p> : null}
          {proposal.changes.length > 0 ? (
            <>
              <p>{t("tailoredCv.changesIntro")}</p>
              <ul className="stack tailored-cv-changes">
                {proposal.changes.map((change) => (
                  <ChangeItem key={change.id} change={change} accepted={decisionOf(change, decisions)} onDecide={(accepted) => decide(change, accepted)} />
                ))}
              </ul>
            </>
          ) : (
            <p>{t("tailoredCv.noChanges")}</p>
          )}

          {awaitingAccept ? <p className="notice">{t("tailoredCv.pendingHint")}</p> : null}
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
          <LiveActionStatus action={action} />
        </div>
      ) : (
        <>
          <p>{t(saved ? "tailoredCv.noneSinceSaved" : "tailoredCv.none")}</p>
          <button className="button button-primary" type="button" onClick={propose} disabled={status === "proposing"}>
            {status === "proposing" ? t("tailoredCv.proposing") : t("tailoredCv.propose")}
          </button>
          <LiveActionStatus action={action} />
        </>
      )}
      <StatusMessage status={status} />
    </div>
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

/** One change, shown against the Master CV, for the Candidate to accept or reject. `accepted`: null until they decide, for a change that waits for it. */
function ChangeItem({ change, accepted, onDecide }: { change: CvChange; accepted: boolean | null; onDecide: (accepted: boolean) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const heading = [t(`tailoredCv.sections.${change.section}`), t(`tailoredCv.kinds.${change.kind}`), change.item].filter(Boolean).join(" · ");
  return (
    <li className="board-card stack">
      <p id={`${id}-heading`} className="cv-entry">
        {heading}
      </p>
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
      {change.fromOffer?.length ? (
        // Kept as written, for the Candidate to check (ADR-0006, #68): the Master CV does not say it.
        <p className="error" role="note">
          {t("tailoredCv.fromOffer", { words: change.fromOffer.join(", ") })}
        </p>
      ) : null}
      {/* Each button tells which change it decides, without naming it after the change: the question groups are named after requirements. */}
      <div className="actions">
        <button className="button" type="button" aria-pressed={accepted === true} aria-describedby={`${id}-heading`} onClick={() => onDecide(true)}>
          {t("tailoredCv.accept")}
        </button>
        <button className="button" type="button" aria-pressed={accepted === false} aria-describedby={`${id}-heading`} onClick={() => onDecide(false)}>
          {t("tailoredCv.reject")}
        </button>
      </div>
      {accepted === null ? <p className="hint">{t("tailoredCv.awaitingAccept")}</p> : null}
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
      {cv.skills.length > 0 ? (
        <>
          <p id={`${id}-skills`} className="cv-entry">
            {t("cvReview.skills")}
          </p>
          <SkillTags skills={cv.skills} label={t("cvReview.skills")} />
        </>
      ) : null}
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
