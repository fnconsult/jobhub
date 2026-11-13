"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "./icons";

/** One of the AI Coach's lines in a page's thread: unframed text, its author heard by screen readers only (#317). */
export function CoachLine({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {children}
    </li>
  );
}

/**
 * « Dans l'activité » under a reply or a card of a thread (#808), or a line of the coach (#1006): opens the page's Activity
 * on its entry.
 */
export function InActivity({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="chat-in-activity" onClick={onShow}>
      <Icons.aiActivity />
      {t("aiActivity.history.inActivity")}
    </button>
  );
}
