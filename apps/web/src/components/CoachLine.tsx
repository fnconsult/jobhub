"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
