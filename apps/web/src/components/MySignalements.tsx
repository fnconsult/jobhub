"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { send } from "@/components/ApplicationControls";
import {
  MY_SIGNALEMENTS_TITLE_ID,
  SignalementProvider,
  SignalementTypeButton,
} from "@/components/Signalement";
import { signalementGlyph } from "@/components/signalement-glyphs";
import type { SignalementStatus, SignalementType } from "@/signalements/values";

/** One of the Candidate's Signalements as « Mes signalements » shows it, its dates already worded by the server. */
export interface MySignalement {
  id: string;
  type: SignalementType;
  /** « Bug du 25 octobre ». */
  heading: string;
  message: string;
  status: SignalementStatus;
  /** A Question's « Ce qui a été joint »: the Candidate's question to the coach and the coach's reply. */
  attached: { question: string; coachReply: string } | null;
  /** The team's reply, with the day it was first saved (null when not known) and, once changed, the day it last was. */
  reply: { text: string; on: string | null; changedOn: string | null } | null;
}

/**
 * Mon compte's « Mes signalements » (#377): the Signalements the Candidate sent, newest first, each with its type,
 * date, full message and status, a Question's attachments collapsed, and the team's reply signed « Réponse de l'équipe
 * Jobbbox ». No thread, no editing: each can be deleted, after a question asked in place. With none, the two buttons
 * open the Signalement dialog on a Bug or an Idée. `version`: the Jobbbox version that dialog shows.
 */
export function MySignalements({
  signalements,
  version,
}: {
  signalements: MySignalement[];
  version: string;
}) {
  const { t } = useTranslation();
  const [deleted, setDeleted] = useState<string[]>([]);
  const title = useRef<HTMLHeadingElement>(null);
  const shown = signalements.filter(
    (signalement) => !deleted.includes(signalement.id),
  );

  function onDeleted(signalementId: string) {
    setDeleted((current) => [...current, signalementId]);
    // Its item is gone, with the button that had the focus: the Section's title takes it.
    requestAnimationFrame(() => title.current?.focus());
  }

  return (
    <SignalementProvider version={version}>
      <section
        className="stack my-signalements"
        aria-labelledby={MY_SIGNALEMENTS_TITLE_ID}
      >
        <h2 id={MY_SIGNALEMENTS_TITLE_ID} ref={title} tabIndex={-1}>
          {t("mySignalements.title")}
        </h2>
        <p role="status" className="my-signalements-status">
          {deleted.length > 0 ? t("mySignalements.deleted") : null}
        </p>
        {shown.length === 0 ? (
          <div className="stack">
            <p>
              <strong>{t("mySignalements.empty")}</strong>
            </p>
            <p>{t("mySignalements.emptyHint")}</p>
            <div className="actions">
              <SignalementTypeButton type="bug">
                {t("mySignalements.reportProblem")}
              </SignalementTypeButton>
              <SignalementTypeButton type="idee">
                {t("mySignalements.proposeIdea")}
              </SignalementTypeButton>
            </div>
          </div>
        ) : (
          <>
            <p>{t("mySignalements.intro")}</p>
            <ul
              className="my-signalement-list"
              aria-label={t("mySignalements.listLabel")}
            >
              {shown.map((signalement) => (
                <Item
                  key={signalement.id}
                  signalement={signalement}
                  onDeleted={() => onDeleted(signalement.id)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </SignalementProvider>
  );
}

function Item({
  signalement,
  onDeleted,
}: {
  signalement: MySignalement;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <li className="my-signalement">
      <article className="stack" aria-labelledby={`${id}-heading`}>
        <h3 id={`${id}-heading`} className="my-signalement-heading">
          <svg
            className="icon signalement-glyph"
            viewBox="0 0 24 24"
            aria-hidden
            focusable={false}
          >
            <path d={signalementGlyph(signalement.type)} />
          </svg>
          {signalement.heading}
        </h3>
        <p
          className={`my-signalement-status my-signalement-status-${signalement.status}`}
        >
          {t("mySignalements.status", {
            status: t(`mySignalements.statuses.${signalement.status}`),
          })}
        </p>
        <p className="signalement-text">{signalement.message}</p>
        {signalement.attached ? (
          <details className="my-signalement-attached">
            <summary>{t("mySignalements.attached")}</summary>
            <dl>
              <dt>{t("mySignalements.attachedQuestion")}</dt>
              <dd className="signalement-text">
                {signalement.attached.question}
              </dd>
              <dt>{t("mySignalements.attachedCoachReply")}</dt>
              <dd className="signalement-text">
                {signalement.attached.coachReply}
              </dd>
            </dl>
          </details>
        ) : null}
        {signalement.reply ? (
          <section
            className="my-signalement-reply"
            aria-labelledby={`${id}-reply`}
          >
            <h4 id={`${id}-reply`}>{t("mySignalements.reply")}</h4>
            {signalement.reply.on ? (
              <p className="signalement-meta">
                {t("mySignalements.repliedOn", { date: signalement.reply.on })}
                {signalement.reply.changedOn
                  ? `, ${t("mySignalements.changedOn", { date: signalement.reply.changedOn })}`
                  : null}
              </p>
            ) : null}
            <p className="signalement-text">{signalement.reply.text}</p>
          </section>
        ) : null}
        <DeleteButton
          signalementId={signalement.id}
          heading={signalement.heading}
          onDeleted={onDeleted}
        />
      </article>
    </li>
  );
}

/**
 * « Supprimer », asked first in place: « Oui, supprimer » deletes it (gone for the team too) and « Non, garder » goes
 * back to the button. Its accessible name names the Signalement, so that several are told apart.
 */
function DeleteButton({
  signalementId,
  heading,
  onDeleted,
}: {
  signalementId: string;
  heading: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  async function remove() {
    setWorking(true);
    setFailed(false);
    const { ok } = await send(
      `/api/signalements/${encodeURIComponent(signalementId)}`,
      "DELETE",
    );
    setWorking(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    onDeleted();
    router.refresh();
  }

  function keep() {
    setAsking(false);
    setFailed(false);
    // Back to the button once it is shown again.
    requestAnimationFrame(() => button.current?.focus());
  }

  if (!asking)
    return (
      <div className="actions">
        <button
          ref={button}
          className="button"
          type="button"
          aria-label={t("mySignalements.deleteLabel", { heading })}
          onClick={() => setAsking(true)}
        >
          {t("mySignalements.delete")}
        </button>
      </div>
    );
  return (
    <div className="stack" role="group" aria-labelledby={`${id}-question`}>
      <p id={`${id}-question`}>{t("mySignalements.confirmDelete")}</p>
      <div className="actions">
        {/* The question replaces the button the Candidate just pressed: focus goes to its first answer. */}
        <button
          className="button button-danger"
          type="button"
          onClick={remove}
          disabled={working}
          autoFocus
        >
          {working ? t("mySignalements.deleting") : t("mySignalements.confirm")}
        </button>
        <button
          className="button"
          type="button"
          onClick={keep}
          disabled={working}
        >
          {t("mySignalements.keep")}
        </button>
      </div>
      {failed ? (
        <p className="field-error" role="alert">
          {t("mySignalements.deleteFailed")}
        </p>
      ) : null}
    </div>
  );
}
