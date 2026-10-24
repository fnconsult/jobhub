"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { usePageHelp } from "@/components/CoachPanel";
import { EMPTY_STATE_HELP, HELP_TERMS, wordsWithin, type EmptyStateName, type HelpTermName } from "@/help-terms";

/**
 * Help in pages, with no chrome (#343, ADR-0035). A glossary term's first mention on a page opens its Help Article in
 * the Coach Panel; every later mention, and every mention outside a Coach Panel with help, is plain text.
 *
 *   <HelpTerm term="matchScore">{t("matchScore.title")}</HelpTerm>                            // the whole text
 *   <HelpTerm term="planQuota" words={t("helpTerms.words.planQuota")}>{t("…renews")}</HelpTerm> // « quota » only
 *
 * The button reads as text with a dotted accent underline; its accessible name is the words and « (aide) ».
 * `words` are found whatever their case; a sentence that does not contain them (in a language that words it otherwise)
 * names no term: it is plain text, and the next mention can be the page's first.
 */
export function HelpTerm({ term, words, children }: { term: HelpTermName; words?: string; children: string }) {
  const { t } = useTranslation();
  const help = usePageHelp();
  const mentions = help?.mentions;
  const pathname = usePathname();
  const mention = useId();
  const parts = wordsWithin(children, words ?? children);
  const names = parts !== null;
  // Asked while rendering, so the server and the browser agree on which mention is the first.
  const first = mentions && names ? mentions.isFirst(pathname, term, mention) : false;
  useEffect(() => {
    if (!mentions || !names) return;
    // Mounted again (React's strict mode, or a mention shown anew): it takes its place back if it is still free.
    mentions.isFirst(pathname, term, mention);
    return () => mentions.forget(term, mention);
  }, [mentions, names, pathname, term, mention]);

  if (!help || !parts || !first) return children;
  const [before, named, after] = parts;
  return (
    <>
      {before}
      <button type="button" className="help-term" aria-label={`${named} ${t("helpTerms.suffix")}`} onClick={() => help.openHelp(HELP_TERMS[term])}>
        {named}
      </button>
      {after}
    </>
  );
}

/** An empty state's link to its Help Article (« D'où viennent les propositions ? »); nothing outside a Coach Panel with help. */
export function EmptyStateHelp({ of }: { of: EmptyStateName }) {
  const { t } = useTranslation();
  const help = usePageHelp();
  if (!help) return null;
  return (
    <button type="button" className="link-action" onClick={() => help.openHelp(EMPTY_STATE_HELP[of])}>
      {t(`emptyStateHelp.${of}`)}
    </button>
  );
}
