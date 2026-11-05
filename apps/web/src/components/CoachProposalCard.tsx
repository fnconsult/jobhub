"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CardDecisionError, CoachProposalCard as Card } from "@/coach-proposals/card";
import type { ProposalField } from "@/coach-actions";
import { send } from "@/components/ApplicationControls";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { ChangeItem, decisionOf } from "@/components/TailoredCvReview";
import { LiveActionStatus, useLiveAction } from "@/components/LiveAction";
import { InWorkPane } from "@/components/WorkPane";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput, Textarea } from "@/design/Field";
import "./CoachProposalCard.css";

/** « Modifier avant d'appliquer » opens a form in the Work Pane, at the page's own address. */
const FORM: AddressedKind = "form";

/** What the card says after the Candidate's last click: refused (and why), or nothing. */
type Problem = "conflict" | "undoConflict" | "invalid" | "failed" | "noneAccepted" | "runFailed";

/** The hour of a decision, « 18:20 », in the Candidate's language. */
function hourOf(at: string, language: string): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

/**
 * A Coach proposal's Action Card, in the thread under the AI Coach reply that proposes it (#715, ADR-0077): « Proposé par
 * votre coach IA », what changes on which object (a link to it), before → after, the Plan Quota it will use (the Upgrade
 * prompt in place of its buttons without room), and « Appliquer », « Modifier avant d'appliquer » and « Ignorer ».
 * « Modifier avant d'appliquer » opens the page's form, pre-filled, in the Work Pane (ADR-0070), the focus on its title;
 * what is changed there is kept while the pane is closed, and the button opens it again. Once decided it says how
 * (« Appliqué par vous à 18:20 », « Ignoré », « Annulé à 18:25 »), politely announced, and an applied one offers
 * « Annuler » while its object has not changed since. Refused, it says why (« L'objet a changé depuis la proposition »)
 * and stays as it was. `onChange`: the card as the server now has it. `openOnArrival`: the card has just arrived under
 * « Propositions du coach : Formulaire » (#717, formOpenedOnArrival): its form opens by itself as it mounts, and nothing
 * is applied; once only, since the card mounts once in the thread. Opened that way, it leaves the focus where it is (the
 * message box, #775); the button takes it to the form's title.
 *
 * A Master CV change (#719, ADR-0006) has no « Appliquer » in one click: « Relire les changements » opens its changes in
 * the Work Pane, each accepted or rejected on its own (a Flagged Change waits for an explicit accept), and « Enregistrer
 * les changements acceptés » sends the accepted ones, which make one Master CV Version; its « Annuler » is a Restore.
 * The Coach Memory has no page: its card names it without a link.
 * A proposal that launches an action (a Job Search, #720) offers « Lancer » in place of « Appliquer », says « Lancé par
 * vous à 18:20 » and sends to AI Activity, where it is followed and stopped: it has no « Annuler ».
 * A « Documents » proposal (#721, `runs`) offers « Préparer » (a Tailored CV) or « Rédiger » (a Cover Letter, an Outreach
 * Message): applied, its card runs the AI action the documents page runs, through its route, its steps live beside
 * « Arrêter » (and in AI Activity); done, its Result opens in the Work Pane, a Tailored CV's Review to go through change by
 * change. A draft that exists is replaced, edits included: the card says so (`replaces`), and « Rédiger » asks to confirm
 * it first (« Remplacer et rédiger » or « Garder mon brouillon »), the focus on the confirmation.
 */
export function CoachProposalCard({ card, onChange, openOnArrival = false }: { card: Card; onChange: (card: Card) => void; openOnArrival?: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const pane = useWorkPane();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // What the Candidate changed in the form, kept while the Work Pane is closed; each opening mounts it afresh.
  const [edits, setEdits] = useState<Record<string, string>>(() => ({ ...card.change.value, ...card.edited }));
  // A review's accept or reject of each change, by id, kept while the Work Pane is closed.
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  // The opening on arrival, if any: it leaves the focus in the message box, where the Candidate is (#775); the
  // Candidate's own « Modifier avant d'appliquer » takes it to the form.
  const [arrivalOpening] = useState(() => (openOnArrival && pane ? 1 : 0));
  const [opening, setOpening] = useState(arrivalOpening);
  // Without a Work Pane (« Conversation au centre » off), the form opens in the card.
  const [inlineForm, setInlineForm] = useState(() => openOnArrival && !pane);
  const editButton = useRef<HTMLButtonElement>(null);
  const { change } = card;
  const run = change.runs;
  // A « Documents » proposal's AI action, run in the Candidate's own request (#721).
  const live = useLiveAction(run?.kind ?? "tailored_cv");
  // The replacement of a draft that exists, being confirmed; the focus goes to the confirmation, then back.
  const [confirming, setConfirming] = useState(false);
  const launchButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const confirmId = useId();
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
    else if (confirmed.current) launchButton.current?.focus();
    confirmed.current = confirming;
  }, [confirming]);
  const formHref = `${pathname}#proposition-${card.id}`;
  const formShown = pane ? pane.item?.kind === FORM && pane.item.href === formHref : inlineForm;

  async function decide(decision: "accept" | "dismiss" | "undo", edited?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    const { ok, result } = await send(`/api/action-cards/${encodeURIComponent(card.id)}`, "POST", { decision, ...(edited ? { edited } : {}) });
    setBusy(false);
    if (ok && result.card) {
      onChange(result.card as Card);
      // The object changed: the page shows it as it now is (the Fiche's status, its « Origine »).
      if (decision !== "dismiss") router.refresh();
      return true;
    }
    const error = result.error as CardDecisionError | undefined;
    setProblem(error === "conflict" ? (decision === "undo" ? "undoConflict" : "conflict") : error === "invalid" ? "invalid" : "failed");
    return false;
  }

  /** « Préparer » or « Rédiger »: the card applied, then the AI action run; done, its Result opens in the Work Pane. */
  async function launch() {
    if (!run) return;
    setConfirming(false);
    confirmed.current = false;
    if (!(await decide("accept"))) return;
    const outcome = await live.run(run.url, run.body);
    if (outcome.ok) router.push(run.opens, { scroll: false });
    else if (!("stopped" in outcome)) setProblem("runFailed");
  }

  function openForm() {
    if (pane) setOpening((n) => n + 1);
    else setInlineForm(true);
  }

  async function applyEdited(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await decide("accept", edits))) return;
    if (pane) pane.close(() => editButton.current ?? document.getElementById(titleId));
    else setInlineForm(false);
  }

  /** « Enregistrer les changements acceptés »: the accepted ones, sent explicitly (ADR-0006). */
  async function saveReviewed() {
    const accepted = (change.review?.changes ?? []).filter((each) => decisionOf(each, decisions) === true).map((each) => each.id);
    if (accepted.length === 0) return setProblem("noneAccepted");
    if (!(await decide("accept", { accepted }))) return;
    if (pane) pane.close(() => editButton.current ?? document.getElementById(titleId));
    else setInlineForm(false);
  }

  const review = change.review ? (
    <div className="coach-proposal-form stack">
      <p className="hint">{t("coachProposals.review.intro", { name: change.target.name })}</p>
      <ul className="stack tailored-cv-changes">
        {change.review.changes.map((each) => (
          <ChangeItem
            key={each.id}
            change={each}
            accepted={decisionOf(each, decisions)}
            onDecide={(accepted) => setDecisions((kept) => ({ ...kept, [each.id]: accepted }))}
            labels={{ master: t("coachProposals.review.before"), tailored: t("coachProposals.review.after"), fromOffer: (words) => t("coachProposals.review.fromOffer", { words }) }}
          />
        ))}
      </ul>
      {change.review.changes.some((each) => decisionOf(each, decisions) === null) ? <p className="notice">{t("tailoredCv.pendingHint")}</p> : null}
      {problem && formShown ? <ProblemNote problem={problem} /> : null}
      <div className="actions">
        <button className={buttonClass({ variant: "primary" })} type="button" disabled={busy} onClick={() => void saveReviewed()}>
          {t("coachProposals.review.save")}
        </button>
      </div>
    </div>
  ) : null;

  const form = review ?? (
    <form className="coach-proposal-form stack" onSubmit={applyEdited}>
      <p className="hint">{t("coachProposals.editIntro", { name: change.target.name })}</p>
      {change.fields.map((field) => (
        <ProposalInput key={field.name} field={field} value={edits[field.name] ?? ""} onChange={(value) => setEdits((kept) => ({ ...kept, [field.name]: value }))} />
      ))}
      {problem && formShown ? <ProblemNote problem={problem} /> : null}
      <div className="actions">
        <button className={buttonClass({ variant: "primary" })} type="submit" disabled={busy}>
          {t("coachProposals.apply")}
        </button>
      </div>
    </form>
  );

  const pending = card.status === "pending";
  const shownAfter = card.edited && card.status !== "pending" ? afterEdited(card) : change.after;
  return (
    <article className="coach-proposal-card" aria-labelledby={titleId} data-status={card.status}>
      <p className="coach-proposal-card__by">{t("coachProposals.by")}</p>
      <h4 className="coach-proposal-card__title" id={titleId} tabIndex={-1}>
        {change.what}
        {" · "}
        {change.target.href ? <Link href={change.target.href}>{change.target.name}</Link> : change.target.name}
      </h4>
      {change.also?.length ? (
        // More than one change on the object (#718): each listed, what it is first.
        <ul className="coach-proposal-card__changes">
          {[{ what: change.what, before: change.before, after: shownAfter }, ...change.also].map((each) => (
            <li key={each.what} className="coach-proposal-card__change">
              <span className="coach-proposal-card__what">{t("coachProposals.changeOf", { what: each.what })}</span> <BeforeAfter before={each.before} after={each.after} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="coach-proposal-card__change">
          <BeforeAfter before={change.before} after={shownAfter} />
        </p>
      )}
      {change.quota && !change.quota.prompt ? <p className="hint">{change.quota.label}</p> : null}
      {card.status !== "pending" && card.accepted ? <p className="hint">{t("coachProposals.review.saved", { count: card.accepted.length })}</p> : null}
      {/* Its decision, said politely as it is made (ADR-0009). */}
      <p className="coach-proposal-card__decision" role="status">
        {card.status === "accepted" && card.decidedAt ? t(change.launches ? "coachProposals.launched" : "coachProposals.applied", { time: hourOf(card.decidedAt, i18n.language) }) : null}
        {card.status === "dismissed" ? t("coachProposals.dismissed") : null}
        {card.status === "undone" && card.undoneAt ? t("coachProposals.undone", { time: hourOf(card.undoneAt, i18n.language) }) : null}
      </p>
      {card.status === "accepted" && change.launches && !run ? <p className="hint">{t("coachProposals.launchedHint")}</p> : null}
      {card.status === "accepted" && run ? <LiveActionStatus action={live} /> : null}
      {card.status === "accepted" && run && !live.live ? <p className="hint">{t("coachProposals.runHint")}</p> : null}
      {pending && change.replaces ? <p className="notice">{change.replaces}</p> : null}
      {problem && !formShown ? <ProblemNote problem={problem} /> : null}
      {pending && change.quota?.prompt ? <UpgradePrompt prompt={change.quota.prompt} /> : null}
      {pending && confirming ? (
        <div className="coach-proposal-card__confirm" role="group" aria-labelledby={confirmId}>
          <p id={confirmId}>{t("coachProposals.confirmReplace")}</p>
          <div className="actions">
            <button ref={confirmButton} className={buttonClass({ variant: "primary" })} type="button" disabled={busy} onClick={() => void launch()}>
              {t("coachProposals.confirmYes")}
            </button>
            <button className={buttonClass({ variant: "quiet" })} type="button" disabled={busy} onClick={() => setConfirming(false)}>
              {t("coachProposals.confirmNo")}
            </button>
          </div>
        </div>
      ) : null}
      {pending && !confirming && run && !change.quota?.prompt ? (
        <div className="actions">
          <button ref={launchButton} className={buttonClass({ variant: "primary" })} type="button" disabled={busy} onClick={() => (change.replaces ? setConfirming(true) : void launch())}>
            {t(run.kind === "tailored_cv" ? "coachProposals.prepare" : "coachProposals.draft")}
          </button>
          <button className={buttonClass({ variant: "quiet" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
            {t("coachProposals.dismiss")}
          </button>
        </div>
      ) : null}
      {pending && !run && !change.quota?.prompt ? (
        <div className="actions">
          {change.review ? (
            <button ref={editButton} className={buttonClass({ variant: "primary" })} type="button" disabled={busy} aria-expanded={pane ? undefined : inlineForm} onClick={openForm}>
              {t("coachProposals.review.open")}
            </button>
          ) : (
            <button className={buttonClass({ variant: "primary" })} type="button" disabled={busy} onClick={() => void decide("accept")}>
              {t(change.launches ? "coachProposals.launch" : "coachProposals.apply")}
            </button>
          )}
          {!change.review && change.fields.length > 0 ? (
            <button ref={editButton} className={buttonClass()} type="button" disabled={busy} aria-expanded={pane ? undefined : inlineForm} onClick={openForm}>
              {t("coachProposals.edit")}
            </button>
          ) : null}
          <button className={buttonClass({ variant: "quiet" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
            {t("coachProposals.dismiss")}
          </button>
        </div>
      ) : null}
      {card.status === "accepted" && card.undoable && problem !== "undoConflict" ? (
        <div className="actions">
          <button className={buttonClass()} type="button" disabled={busy} onClick={() => void decide("undo")}>
            {t("coachProposals.undo")}
          </button>
        </div>
      ) : null}
      {pending && pane && opening > 0 ? (
        <InWorkPane key={opening} takeFocus={opening !== arrivalOpening} kind={FORM} title={t(change.review ? "coachProposals.review.title" : "coachProposals.editTitle", { what: change.what })} href={formHref} back={pathname}>
          {form}
        </InWorkPane>
      ) : null}
      {pending && !pane && inlineForm ? form : null}
    </article>
  );
}

/** One change, before → after, read out as « Avant : … , après : … ». */
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="visually-hidden">{t("coachProposals.before")} </span>
      <span className="coach-proposal-card__before">{before}</span>
      <span aria-hidden="true">{" → "}</span>
      <span className="visually-hidden">, {t("coachProposals.after")} </span>
      <span className="coach-proposal-card__after">{after}</span>
    </>
  );
}

/** What an applied card set, when the Candidate edited it before applying: the label of each field's value. */
function afterEdited(card: Card): string {
  const labels = card.change.fields.flatMap((field) => {
    const value = card.edited?.[field.name];
    if (value === undefined || value === "") return [];
    return [field.options?.find((option) => option.value === value)?.label ?? value];
  });
  return labels.length > 0 ? labels.join(", ") : card.change.after;
}

/** Why the last click was refused, as an alert. */
function ProblemNote({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  return (
    <p className="field-error" role="alert">
      {t(`coachProposals.problems.${problem}`)}
    </p>
  );
}

/** One field of the page's form, pre-filled. */
function ProposalInput({ field, value, onChange }: { field: ProposalField; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={field.label}>
      {field.type === "select" ? (
        <Select name={field.name} value={value} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : field.type === "textarea" ? (
        <Textarea name={field.name} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === "datetime" ? (
        <TextInput type="datetime-local" name={field.name} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === "number" ? (
        <TextInput type="number" inputMode="numeric" min={1} step={1} name={field.name} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <TextInput name={field.name} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}
