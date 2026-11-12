"use client";

import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/Button";
import { InfoDialog } from "@/design/Dialog";
import { useDwellReveal } from "@/design/dwell-reveal";

/**
 * The AI Coach's look on every page that is a conversation (ADR-0070, #652, #997): the welcome panel at the top of the
 * thread, the message box at the foot with the « Coach IA » badge and « Envoyer au coach ». Presentational only, so a page
 * whose coach is scripted (« Créer un profil ») looks the same as one that calls `/api/coach`.
 */

/**
 * The welcome panel, the thread's first message: the AI disclosure (or `opening`, the welcome of a conversation saved
 * before it), the page's Introduction and the help. `onClose`: the ✕ « Ne plus afficher », for good (`useConversationFirst`).
 */
export function WelcomePanel({ opening = "coachPanel.aiDisclosure", onClose, children }: { opening?: "coachPanel.aiDisclosure" | "coachPanel.welcome"; onClose?: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach welcome-panel">
      {/* No visible author (#317, #327): screen readers still hear who speaks. */}
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {onClose ? (
        <button className="welcome-panel-close" type="button" onClick={onClose}>
          <Icons.close />
          {t("conversationFirst.closeWelcome")}
        </button>
      ) : null}
      <p>{t(opening)}</p>
      {children}
    </li>
  );
}

/**
 * The « Coach IA » badge in the box (#324): says the one answering is an AI, and opens the welcome panel again in a
 * dialog, AI disclosure first, then `children` (the page's Introduction and the help).
 */
export function CoachBadge({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  const dwell = useDwellReveal();
  return (
    <InfoDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("conversationFirst.welcomeTitle")}
      trigger={
        <button className="pill coach-panel-badge" data-tone="accent" type="button" aria-label={t("conversationFirst.welcomeOpen")} {...dwell}>
          <span className="composer-label">{t("coachPanel.badge")}</span>
          {/* While the Candidate writes, « IA » in place of « Coach IA » (#933): still says an AI answers. */}
          <span className="composer-short" aria-hidden="true">
            {t("coachPanel.badgeShort")}
          </span>
        </button>
      }
    >
      <p>{t("coachPanel.aiDisclosure")}</p>
      {children}
    </InfoDialog>
  );
}

/** « Envoyer au coach », its icon alone while the Candidate writes (#933). */
export function SendButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const dwell = useDwellReveal();
  return (
    <button key="send" className={`${buttonClass({ variant: "primary" })} composer-send`} type="submit" disabled={disabled} {...dwell}>
      <Icons.enter />
      <span className="composer-label">{t("coachPanel.send")}</span>
    </button>
  );
}

/**
 * The message box: `textarea` with the badge and the send action inside it; a click anywhere in the box writes in it.
 * One line to start with, the badge and Send on its row where the column has room (#933), in words while it is empty,
 * their icons while the Candidate `writing`; it grows with the text.
 */
export function CoachComposer({
  inputRef,
  writing,
  textarea,
  badge,
  action,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  writing: boolean;
  textarea: ReactNode;
  badge: ReactNode;
  action: ReactNode;
}) {
  return (
    <div
      className="coach-panel-composer coach-panel-composer-inline"
      data-writing={writing ? "" : undefined}
      onClick={(event) => event.target === event.currentTarget && inputRef.current?.focus()}
    >
      {textarea}
      <div className="coach-panel-composer-actions">
        {badge}
        {action}
      </div>
    </div>
  );
}
