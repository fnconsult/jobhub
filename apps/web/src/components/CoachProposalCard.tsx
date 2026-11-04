"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CardDecisionError, CoachProposalCard as Card } from "@/coach-proposals/card";
import type { ProposalField } from "@/coach-actions";
import { send } from "@/components/ApplicationControls";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { InWorkPane } from "@/components/WorkPane";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput, Textarea } from "@/design/Field";
import "./CoachProposalCard.css";

/** « Modifier avant d'appliquer » opens a form in the Work Pane, at the page's own address. */
const FORM: AddressedKind = "form";

/** What the card says after the Candidate's last click: refused (and why), or nothing. */
type Problem = "conflict" | "undoConflict" | "invalid" | "failed";

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
 * « Propositions du coach : Formulaire » (#717, formOpenedOnArrival): its form opens by itself as it mounts, as the
 * button would open it, and nothing is applied; once only, since the card mounts once in the thread.
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
  const [opening, setOpening] = useState(() => (openOnArrival && pane ? 1 : 0));
  // Without a Work Pane (« Conversation au centre » off), the form opens in the card.
  const [inlineForm, setInlineForm] = useState(() => openOnArrival && !pane);
  const editButton = useRef<HTMLButtonElement>(null);
  const { change } = card;
  const formHref = `${pathname}#proposition-${card.id}`;
  const formShown = pane ? pane.item?.kind === FORM && pane.item.href === formHref : inlineForm;

  async function decide(decision: "accept" | "dismiss" | "undo", edited?: Record<string, string>): Promise<boolean> {
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

  const form = (
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
  return (
    <article className="coach-proposal-card" aria-labelledby={titleId} data-status={card.status}>
      <p className="coach-proposal-card__by">{t("coachProposals.by")}</p>
      <h4 className="coach-proposal-card__title" id={titleId} tabIndex={-1}>
        {change.what}
        {" · "}
        <Link href={change.target.href}>{change.target.name}</Link>
      </h4>
      <p className="coach-proposal-card__change">
        <span className="visually-hidden">{t("coachProposals.before")} </span>
        <span className="coach-proposal-card__before">{change.before}</span>
        <span aria-hidden="true">{" → "}</span>
        <span className="visually-hidden">, {t("coachProposals.after")} </span>
        <span className="coach-proposal-card__after">{card.edited && card.status !== "pending" ? afterEdited(card) : change.after}</span>
      </p>
      {change.quota && !change.quota.prompt ? <p className="hint">{change.quota.label}</p> : null}
      {/* Its decision, said politely as it is made (ADR-0009). */}
      <p className="coach-proposal-card__decision" role="status">
        {card.status === "accepted" && card.decidedAt ? t("coachProposals.applied", { time: hourOf(card.decidedAt, i18n.language) }) : null}
        {card.status === "dismissed" ? t("coachProposals.dismissed") : null}
        {card.status === "undone" && card.undoneAt ? t("coachProposals.undone", { time: hourOf(card.undoneAt, i18n.language) }) : null}
      </p>
      {problem && !formShown ? <ProblemNote problem={problem} /> : null}
      {pending && change.quota?.prompt ? <UpgradePrompt prompt={change.quota.prompt} /> : null}
      {pending && !change.quota?.prompt ? (
        <div className="actions">
          <button className={buttonClass({ variant: "primary" })} type="button" disabled={busy} onClick={() => void decide("accept")}>
            {t("coachProposals.apply")}
          </button>
          {change.fields.length > 0 ? (
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
        <InWorkPane key={opening} kind={FORM} title={t("coachProposals.editTitle", { what: change.what })} href={formHref} back={pathname}>
          {form}
        </InWorkPane>
      ) : null}
      {pending && !pane && inlineForm ? form : null}
    </article>
  );
}

/** What an applied card set, when the Candidate edited it before applying: the label of each field's value. */
function afterEdited(card: Card): string {
  const labels = card.change.fields.flatMap((field) => {
    const value = card.edited?.[field.name];
    if (value === undefined) return [];
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
      ) : (
        <TextInput name={field.name} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}
