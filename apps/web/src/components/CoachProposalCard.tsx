"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CardDecisionError, CoachProposalCard as Card } from "@/coach-proposals/card";
import type { ProposalField } from "@/coach-actions";
import { send } from "@/components/ApplicationControls";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { ChangeItem } from "@/components/TailoredCvReview";
import { LiveActionStatus, useLiveAction } from "@/components/LiveAction";
import { InWorkPane } from "@/components/WorkPane";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput, Textarea } from "@/design/Field";
import "@/design/Card.css";
import "./CoachProposalCard.css";

/** « Modifier avant d'appliquer » opens a form in the Work Pane, at the page's own address. */
const FORM: AddressedKind = "form";

/** What the card says after the Candidate's last click: refused (and why), or nothing. */
/**
 * A change of a Coach's Master CV review as the Candidate decided it: none pre-accepted (ADR-0077), each waits for its own
 * « Accepter » or « Refuser »; only the accepted ones are sent with « Enregistrer les changements acceptés ».
 */
const decisionOf = (change: { id: string }, decisions: Record<string, boolean>): boolean | null => decisions[change.id] ?? null;

type Problem = "conflict" | "undoConflict" | "invalid" | "failed" | "noneAccepted" | "runFailed" | "dossierFailed" | "sendFailed";

/** The hour of a decision, « 18:20 », in the Candidate's language. */
function hourOf(at: string, language: string): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

/**
 * A Coach proposal's Action Card, in the thread under the AI Coach reply that proposes it (#715, ADR-0077): « Proposé par
 * votre coach IA », what changes on which object (a link to it), before → after, the Plan Quota it will use (the Upgrade
 * prompt in place of its buttons without room), and « Appliquer », « Modifier avant d'appliquer » and « Ignorer ». A
 * Design System Card, as wide as it needs (#788), its buttons small Design System Buttons.
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
 * A Tailored CV change (ADR-0113) takes the same path, its review about the Tailored CV; a Layout-only Change says « Mise
 * en forme seule, aucun mot ajouté ». In either review a Declared Fact is marked « Fait déclaré par vous », and a change with
 * words of the Job Offer « Reprend les mots de l'offre ».
 * The Coach Memory has no page: its card names it without a link.
 * A proposal that launches an action (a Job Search, #720) offers « Lancer » in place of « Appliquer », says « Lancé par
 * vous à 18:20 » and sends to AI Activity, where it is followed and stopped: it has no « Annuler ».
 * A « Documents » proposal (#721, `runs`) offers « Préparer » (a Tailored CV) or « Rédiger » (a Cover Letter, an Outreach
 * Message): applied, its card runs the AI action the documents page runs, through its route, its steps live beside
 * « Arrêter » (and in AI Activity); done, its Result opens in the Work Pane, a Tailored CV's Review to go through change by
 * change. A draft that exists is replaced, edits included: the card says so (`replaces`), and « Rédiger » asks to confirm
 * it first (« Remplacer et rédiger » or « Garder mon brouillon »), the focus on the confirmation. So does « Préparer » when
 * a Tailored CV proposal still waits for its review, answers included (#774): « Remplacer et préparer » or « Garder ma
 * proposition ».
 * A reply to an Exchange (#1099, ADR-0115, `handOver`) is the Candidate's to send: its card shows to whom, the subject and
 * the whole text, and offers « Copier » and « Ouvrir dans ma messagerie » (a `mailto:` link) in place of « Appliquer »,
 * each saying it was taken (« Prise par vous à 18:20 »); Jobbbox sends nothing, and the Application Status does not move.
 * A Send (ADR-0119, #1162, `send`) « Envoyer à Prénom N. » shows the whole text, its subject, the recipient, who it goes
 * out as (« Prénom Nom via Jobbbox ») and the Candidate's sign-in email in copy and as Reply-To, and today's Sends of the
 * cap; « Envoyer » sends it, once (its buttons off while it is sent, a second click ignored), « Modifier avant d'envoyer »
 * opens its subject and text in the Work Pane. Sent, it says so (« Envoyé par vous à 18:20 »), with no « Annuler ». The cap
 * reached, or an email whose fate is unknown, is said on the card, with no « Envoyer ».
 */
export function CoachProposalCard({ card, onChange, openOnArrival = false }: { card: Card; onChange: (card: Card) => void; openOnArrival?: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const pane = useWorkPane();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  // One decision at a time: a second click while the first is sent is ignored (#1162: a double click sends once).
  const deciding = useRef(false);
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
  // A reply the Candidate sends from their own mailbox (#1099): copied or opened there, never sent by Jobbbox.
  const handOver = card.change.handOver;
  // An email Jobbbox sends in the Candidate's name on their click (#1162); none once the cap is reached or its fate unknown.
  const sending = card.change.send;
  const sendable = sending && !sending.capReached && !sending.uncertain;
  const [copied, setCopied] = useState<"copied" | "copyFailed" | null>(null);
  const formShown = pane ? pane.item?.kind === FORM && pane.item.href === formHref : inlineForm;

  async function decide(decision: "accept" | "dismiss" | "undo", edited?: Record<string, unknown>): Promise<boolean> {
    if (deciding.current) return false;
    deciding.current = true;
    setBusy(true);
    setProblem(null);
    const { ok, result } = await send(`/api/action-cards/${encodeURIComponent(card.id)}`, "POST", { decision, ...(edited ? { edited } : {}) }).finally(() => {
      deciding.current = false;
    });
    setBusy(false);
    if (ok && result.card) {
      onChange(result.card as Card);
      // The object changed: the page shows it as it now is (the Fiche's status, its « Origine »).
      if (decision !== "dismiss") router.refresh();
      return true;
    }
    const error = result.error as CardDecisionError | undefined;
    // No room left since the proposal (#773): the card, still pending, now shows the Upgrade prompt in place of its buttons.
    if (error === "quota" && result.card) {
      onChange(result.card as Card);
      return false;
    }
    setProblem(error === "conflict" ? (decision === "undo" ? "undoConflict" : "conflict") : error === "invalid" ? "invalid" : sending && decision === "accept" ? "sendFailed" : "failed");
    return false;
  }

  /** « Copier »: the reply's text on the clipboard, then the card marked as taken (once). */
  async function copyReply() {
    try {
      await navigator.clipboard.writeText(card.change.after);
      setCopied("copied");
    } catch {
      setCopied("copyFailed");
      return;
    }
    if (card.status === "pending") await decide("accept");
  }

  /** « Ouvrir dans ma messagerie »: the link opens the Candidate's mailbox; the card is marked as taken (once). */
  function openedReply() {
    if (card.status === "pending") void decide("accept");
  }

  /** « Préparer » or « Rédiger »: the card applied, then the AI action run; done, its Result opens in the Work Pane. */
  async function launch() {
    if (!run) return;
    setConfirming(false);
    confirmed.current = false;
    if (!(await decide("accept"))) return;
    const outcome = await live.run(run.url, run.body);
    if (outcome.ok) router.push(run.opens, { scroll: false });
    else if (!("stopped" in outcome)) setProblem(run.kind === "company_dossier" ? "dossierFailed" : "runFailed");
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
      <p className="hint">{t(change.target.kind === "application" ? "coachProposals.review.introTailoredCv" : "coachProposals.review.intro", { name: change.target.name })}</p>
      <ul className="stack tailored-cv-changes">
        {change.review.changes.map((each) => (
          <ChangeItem
            key={each.id}
            change={each}
            accepted={decisionOf(each, decisions)}
            onDecide={(accepted) => setDecisions((kept) => ({ ...kept, [each.id]: accepted }))}
            labels={{
              master: t("coachProposals.review.before"),
              tailored: t("coachProposals.review.after"),
              fromOffer: (words) => t("coachProposals.review.fromOffer", { words }),
              declared: t("coachProposals.review.declared"),
            }}
          />
        ))}
      </ul>
      {change.review.changes.some((each) => decisionOf(each, decisions) === null) ? <p className="notice">{t("coachProposals.review.pending")}</p> : null}
      {problem && formShown ? <ProblemNote problem={problem} /> : null}
      <div className="actions">
        <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => void saveReviewed()}>
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
        <button className={buttonClass({ variant: "primary", size: "sm" })} type="submit" disabled={busy || (sending && !sendable)}>
          {t(sending ? "coachProposals.send.send" : "coachProposals.apply")}
        </button>
      </div>
    </form>
  );

  const pending = card.status === "pending";
  // The object it changes, named in its title (ADR-0114): « CV de référence · Profil Finance », « CV adapté · Benchling ».
  const objectName = change.target.kind === "profile" ? t("coachProposals.profileName", { name: change.target.name }) : change.target.name;
  const shownAfter = card.edited && card.status !== "pending" ? afterEdited(card) : change.after;
  // A draft's new text (ADR-0109): its form has the text as a textarea, shown in full rather than as « before → after ».
  const textField = change.fields.find((field) => field.type === "textarea" && field.name === "text");
  const shownText = textField && card.edited && card.status !== "pending" ? (card.edited[textField.name] ?? change.after) : change.after;
  // A text proposed in full beside the other changes (ADR-0114: an Interview's note), as the Candidate applied it.
  const fullText = change.text;
  const shownFullText = fullText && card.edited && card.status !== "pending" ? (card.edited[fullText.name] ?? fullText.after) : fullText?.after;
  return (
    <article className="ds-card coach-proposal-card" aria-labelledby={titleId} data-status={card.status}>
      <p className="coach-proposal-card__by">{t("coachProposals.by")}</p>
      <div className="ds-card__head">
        <h4 className="ds-card__title coach-proposal-card__title" id={titleId} tabIndex={-1}>
          {change.what}
          {" · "}
          {change.target.href ? <Link href={change.target.href}>{objectName}</Link> : objectName}
        </h4>
      </div>
      {sending ? (
        <div className="coach-proposal-card__texts">
          <p className="hint">{t("coachProposals.send.to", { to: sending.to.name ? `${sending.to.name} <${sending.to.email}>` : sending.to.email })}</p>
          <p className="hint">{t("coachProposals.send.as", { as: sending.as })}</p>
          <p className="hint">{t("coachProposals.send.copy", { copyTo: sending.copyTo })}</p>
          <p className="hint">{t("coachProposals.send.subject", { subject: card.edited?.subject && card.status !== "pending" ? card.edited.subject : change.before })}</p>
          <p className="coach-proposal-card__text">{shownText}</p>
          {pending && !sending.capReached && !sending.uncertain ? <p className="hint">{t("coachProposals.send.room", sending.room)}</p> : null}
          {pending ? <p className="hint">{t("coachProposals.send.noUndo")}</p> : null}
          {pending && sending.capReached ? <p className="notice">{t("coachProposals.send.capReached", { cap: sending.room.cap })}</p> : null}
          {pending && sending.uncertain ? <p className="notice">{t("coachProposals.send.uncertain")}</p> : null}
        </div>
      ) : handOver ? (
        <div className="coach-proposal-card__texts">
          <p className="hint">{t("coachProposals.handOver.to", { to: handOver.to, subject: handOver.subject })}</p>
          <p className="coach-proposal-card__text">{change.after}</p>
          <p className="hint">{t("coachProposals.handOver.nothingSent")}</p>
        </div>
      ) : textField ? (
        <div className="coach-proposal-card__texts">
          <p className="coach-proposal-card__text">{shownText}</p>
          <details className="coach-proposal-card__current">
            <summary>{t("coachProposals.currentText")}</summary>
            <p className="coach-proposal-card__text">{change.before}</p>
          </details>
        </div>
      ) : change.also?.length ? (
        // More than one change on the object (#718): each listed, what it is first.
        <ul className="coach-proposal-card__changes">
          {[{ what: change.what, before: change.before, after: shownAfter }, ...change.also].map((each) => (
            <li key={each.what} className="coach-proposal-card__change">
              <span className="coach-proposal-card__what">{t("coachProposals.changeOf", { what: each.what })}</span> <BeforeAfter before={each.before} after={each.after} />
            </li>
          ))}
        </ul>
      ) : fullText && change.before === change.after ? (
        // Only its text changes: the object named as it is (the Interview), the text below.
        <p className="coach-proposal-card__change">{change.after}</p>
      ) : (
        <p className="coach-proposal-card__change">
          <BeforeAfter before={change.before} after={shownAfter} />
        </p>
      )}
      {fullText ? (
        <div className="coach-proposal-card__texts">
          <p className="coach-proposal-card__what">{t("coachProposals.changeOf", { what: fullText.what })}</p>
          <p className="coach-proposal-card__text">{shownFullText}</p>
          {fullText.before ? (
            <details className="coach-proposal-card__current">
              <summary>{t("coachProposals.currentText")}</summary>
              <p className="coach-proposal-card__text">{fullText.before}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {/* A Layout-only Change (ADR-0113): still reviewed change by change, but no word is added. */}
      {change.layoutOnly ? <p className="hint">{t("coachProposals.layoutOnly")}</p> : null}
      {change.quota && !change.quota.prompt ? <p className="hint">{change.quota.label}</p> : null}
      {card.status !== "pending" && card.accepted ? <p className="hint">{t("coachProposals.review.saved", { count: card.accepted.length })}</p> : null}
      {/* Its decision, said politely as it is made (ADR-0009). */}
      <p className="coach-proposal-card__decision" role="status">
        {card.status === "accepted" && card.decidedAt
          ? t(sending ? "coachProposals.send.sent" : handOver ? "coachProposals.handOver.handedOver" : change.launches ? "coachProposals.launched" : "coachProposals.applied", { time: hourOf(card.decidedAt, i18n.language) })
          : null}
        {copied ? ` ${t(`coachProposals.handOver.${copied}`)}` : null}
        {card.status === "dismissed" ? t("coachProposals.dismissed") : null}
        {card.status === "undone" && card.undoneAt ? t("coachProposals.undone", { time: hourOf(card.undoneAt, i18n.language) }) : null}
        {card.status === "undone" && card.undoNote ? ` ${t(`coachProposals.undoNotes.${card.undoNote}`)}` : null}
      </p>
      {card.status === "accepted" && change.launches && !run ? <p className="hint">{t("coachProposals.launchedHint")}</p> : null}
      {card.status === "accepted" && run ? <LiveActionStatus action={live} /> : null}
      {card.status === "accepted" && run && !live.live ? (
        // Where the Result is (ADR-0109): its Section and name, and a link opening it in the Work Pane beside the conversation.
        <p className="hint">
          {t(`coachProposals.runResult.${resultOf(run)}`)} <Link href={run.opens} scroll={false}>{t("coachProposals.openResult")}</Link> {t(run.kind === "company_dossier" ? "coachProposals.runStoppedDossier" : "coachProposals.runStopped")}
        </p>
      ) : null}
      {pending && change.replaces ? <p className="notice">{change.replaces}</p> : null}
      {problem && !formShown ? <ProblemNote problem={problem} /> : null}
      {pending && change.quota?.prompt ? <UpgradePrompt prompt={change.quota.prompt} /> : null}
      {pending && confirming ? (
        <div className="coach-proposal-card__confirm" role="group" aria-labelledby={confirmId}>
          <p id={confirmId}>{t(run?.kind === "tailored_cv" ? "coachProposals.confirmReplaceProposal" : "coachProposals.confirmReplace")}</p>
          <div className="actions">
            <button ref={confirmButton} className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => void launch()}>
              {t(run?.kind === "tailored_cv" ? "coachProposals.confirmYesProposal" : "coachProposals.confirmYes")}
            </button>
            <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy} onClick={() => setConfirming(false)}>
              {t(run?.kind === "tailored_cv" ? "coachProposals.confirmNoProposal" : "coachProposals.confirmNo")}
            </button>
          </div>
        </div>
      ) : null}
      {pending && !confirming && run && !change.quota?.prompt ? (
        <div className="actions">
          <button ref={launchButton} className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => (change.replaces ? setConfirming(true) : void launch())}>
            {t(LAUNCH_LABEL[run.kind])}
          </button>
          <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
            {t("coachProposals.dismiss")}
          </button>
        </div>
      ) : null}
      {handOver && (pending || card.status === "accepted") ? (
        <div className="actions">
          <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => void copyReply()}>
            {t("coachProposals.handOver.copy")}
          </button>
          <a className={buttonClass({ size: "sm" })} href={mailtoOf(handOver, change.after)} onClick={openedReply}>
            {t("coachProposals.handOver.open")}
          </a>
          {pending ? (
            <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
              {t("coachProposals.dismiss")}
            </button>
          ) : null}
        </div>
      ) : null}
      {pending && sending ? (
        <div className="actions">
          {sendable ? (
            <>
              <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("accept")}>
                {t("coachProposals.send.send")}
              </button>
              <button ref={editButton} className={buttonClass({ size: "sm" })} type="button" disabled={busy} aria-expanded={pane ? undefined : inlineForm} onClick={openForm}>
                {t("coachProposals.send.edit")}
              </button>
            </>
          ) : null}
          <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
            {t("coachProposals.dismiss")}
          </button>
        </div>
      ) : null}
      {pending && !run && !handOver && !sending && !change.quota?.prompt ? (
        <div className="actions">
          {change.review ? (
            <button ref={editButton} className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} aria-expanded={pane ? undefined : inlineForm} onClick={openForm}>
              {t("coachProposals.review.open")}
            </button>
          ) : (
            <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("accept")}>
              {t(change.launches ? "coachProposals.launch" : "coachProposals.apply")}
            </button>
          )}
          {!change.review && change.fields.length > 0 ? (
            <button ref={editButton} className={buttonClass({ size: "sm" })} type="button" disabled={busy} aria-expanded={pane ? undefined : inlineForm} onClick={openForm}>
              {t("coachProposals.edit")}
            </button>
          ) : null}
          <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy} onClick={() => void decide("dismiss")}>
            {t("coachProposals.dismiss")}
          </button>
        </div>
      ) : null}
      {card.status === "accepted" && card.undoable && problem !== "undoConflict" ? (
        <div className="actions">
          <button className={buttonClass({ size: "sm" })} type="button" disabled={busy} onClick={() => void decide("undo")}>
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

/** The `mailto:` link of a reply to an Exchange (#1099): to its sender, with its subject and text, for the Candidate's own mailbox. */
export function mailtoOf(handOver: { to: string; subject: string }, text: string): string {
  return `mailto:${encodeURIComponent(handOver.to)}?subject=${encodeURIComponent(handOver.subject)}&body=${encodeURIComponent(text)}`;
}

/** The Result a launched run produces: a Tailored CV, or the Tailored Document its body names. */
function resultOf(run: NonNullable<Card["change"]["runs"]>): "tailored_cv" | "cover_letter" | "outreach_message" | "company_dossier" {
  if (run.kind === "tailored_cv" || run.kind === "company_dossier") return run.kind;
  return run.body.document === "outreach_message" ? "outreach_message" : "cover_letter";
}

/** What launches each kind of run from its card: « Préparer » a Tailored CV, « Rédiger » a document, « Mettre à jour » a Company Dossier (ADR-0114). */
const LAUNCH_LABEL = { tailored_cv: "coachProposals.prepare", tailored_documents: "coachProposals.draft", company_dossier: "coachProposals.update" } as const;

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
    // Its full text is shown apart, whole (ADR-0114).
    if (field.name === card.change.text?.name) return [];
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
