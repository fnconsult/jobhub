"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { send } from "@/components/ApplicationControls";
import { buttonClass } from "@/design/button-class";
import { EmptyState } from "@/design/EmptyState";
import "@/design/Card.css";
import "./ApplicationExchanges.css";

/** An Exchange kept on the Application, as its Section shows it: `at`, the date it says it was sent (else received), ISO. */
export interface ShownExchange {
  id: string;
  from: string;
  subject: string;
  text: string;
  at: string;
}

/** An email offered to tie to the Application (« Rattacher à Benchling ? »): never its text before the Candidate's gesture. */
export interface ShownOfferedExchange {
  id: string;
  from: string;
  subject: string;
  employer: string;
  at: string;
}

/**
 * An Application's « Échanges » Section (#1099, ADR-0115): the emails about it that reached the Candidate's Linked
 * mailbox, kept on it (sender, date, subject and text, never attachments), oldest first, each deletable; and above them
 * the emails offered to tie to it, which wait for the Candidate's gesture: « Rattacher à <employeur> » or « Ignorer »
 * (nothing of it kept). Not « Correspondance », which details the Match Score. An Exchange never changes the Application
 * Status; the AI Coach beside it can help answer one, as a draft the Candidate sends from their own mailbox.
 */
export function ApplicationExchanges({ applicationId, kept, offered }: { applicationId: string; kept: ShownExchange[]; offered: ShownOfferedExchange[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The Exchange whose deletion waits for its confirmation.
  const [deleting, setDeleting] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });

  async function act(id: string, method: "POST" | "DELETE") {
    setBusy(id);
    setFailed(false);
    const { ok } = await send(`/api/applications/${encodeURIComponent(applicationId)}/exchanges/${encodeURIComponent(id)}`, method);
    setBusy(null);
    setDeleting(null);
    if (ok) router.refresh();
    else setFailed(true);
  }

  return (
    <section aria-labelledby={titleId} className="application-exchanges stack">
      <h2 id={titleId}>{t("exchanges.title")}</h2>
      <p className="hint">{t("exchanges.intro")}</p>
      {failed ? (
        <p className="field-error" role="alert">
          {t("exchanges.failed")}
        </p>
      ) : null}
      {offered.length > 0 ? (
        <ul className="application-exchanges__offered stack" aria-label={t("exchanges.offeredLabel")}>
          {offered.map((email) => {
            const questionId = `${titleId}-offered-${email.id}`;
            return (
              <li key={email.id} className="ds-card application-exchanges__offer" role="group" aria-labelledby={questionId}>
                <p className="application-exchanges__meta">{t("exchanges.from", { from: email.from, date: date.format(new Date(email.at)) })}</p>
                <p className="application-exchanges__subject">{email.subject || t("exchanges.noSubject")}</p>
                <p id={questionId}>
                  <strong>{t("exchanges.tieQuestion", { employer: email.employer })}</strong>
                </p>
                <div className="actions">
                  <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={busy !== null} onClick={() => void act(email.id, "POST")}>
                    {t("exchanges.tie", { employer: email.employer })}
                  </button>
                  <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy !== null} onClick={() => void act(email.id, "DELETE")}>
                    {t("exchanges.dismiss")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {kept.length === 0 ? (
        <EmptyState title={t("exchanges.none")} headingLevel={3}>
          {t("exchanges.noneHint")}
        </EmptyState>
      ) : (
        <ol className="application-exchanges__list stack">
          {kept.map((exchange) => {
            const subjectId = `${titleId}-${exchange.id}`;
            return (
              <li key={exchange.id}>
                <article className="ds-card application-exchanges__exchange" aria-labelledby={subjectId}>
                  <h3 id={subjectId} className="ds-card__title">
                    {exchange.subject || t("exchanges.noSubject")}
                  </h3>
                  <p className="application-exchanges__meta">{t("exchanges.from", { from: exchange.from, date: date.format(new Date(exchange.at)) })}</p>
                  <p className="application-exchanges__text">{exchange.text}</p>
                  {deleting === exchange.id ? (
                    <div className="actions" role="group" aria-label={t("exchanges.deleteConfirm")}>
                      <p>{t("exchanges.deleteConfirm")}</p>
                      <button className={buttonClass({ variant: "danger", size: "sm" })} type="button" disabled={busy !== null} onClick={() => void act(exchange.id, "DELETE")}>
                        {t("exchanges.deleteYes")}
                      </button>
                      <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy !== null} onClick={() => setDeleting(null)}>
                        {t("exchanges.deleteNo")}
                      </button>
                    </div>
                  ) : (
                    <div className="actions">
                      <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={busy !== null} onClick={() => setDeleting(exchange.id)}>
                        {t("exchanges.delete", { subject: exchange.subject || t("exchanges.noSubject") })}
                      </button>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
      <p className="hint">{t("exchanges.coachHint")}</p>
    </section>
  );
}
