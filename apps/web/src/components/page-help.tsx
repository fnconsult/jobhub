"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { helpArticle, helpLocale } from "@/coach-help";
import { useCloseDrawerThen } from "@/components/SidebarShell";
import { useWorkPane } from "@/components/work-pane";
import { createMentions, type Mentions } from "@/help-terms";

const PageMentions = createContext<Mentions | null>(null);

/**
 * Help in the Candidate's pages (#343, ADR-0035): which mention of a glossary term is the page's first, kept for as long
 * as the layout is (a new page starts afresh by itself, help-terms' Mentions). Its Help Articles open in the Work Pane
 * (#602, ADR-0070), which it must sit inside.
 */
export function PageHelpProvider({ children }: { children: ReactNode }) {
  const [mentions] = useState(createMentions);
  return <PageMentions.Provider value={mentions}>{children}</PageMentions.Provider>;
}

/**
 * Opens a Help Article in the Work Pane, by its id, in the Interface Language: `openHelp("glossary-ats-score")`; nothing
 * for an unknown id. From the Sidebar's drawer on a phone, once the drawer has closed (#608). Null where there is no Work
 * Pane (the Back Office, signed-out pages).
 */
function useOpenHelp(): ((articleId: string) => void) | null {
  const open = useWorkPane()?.open;
  const closeDrawerThen = useCloseDrawerThen();
  const { i18n } = useTranslation();
  const locale = helpLocale(i18n.language);
  return useMemo(
    () =>
      open
        ? (articleId: string) => {
            const article = helpArticle(articleId, locale);
            if (!article) return;
            const show = () => open({ kind: "help", article });
            if (closeDrawerThen) closeDrawerThen(show);
            else show();
          }
        : null,
    [open, locale, closeDrawerThen],
  );
}

/**
 * What help in pages needs (#343): opening a Help Article in the Work Pane, and which mention of a glossary term is the
 * page's first. Null outside the Candidate's pages (signed-out pages, the Back Office).
 */
export function usePageHelp(): { openHelp: (articleId: string) => void; mentions: Mentions } | null {
  const mentions = useContext(PageMentions);
  const openHelp = useOpenHelp();
  return mentions && openHelp ? { openHelp, mentions } : null;
}
