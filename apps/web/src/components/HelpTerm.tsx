"use client";

import { usePathname } from "next/navigation";
import { Fragment, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { usePageHelp } from "@/components/CoachPanel";
import { EMPTY_STATE_HELP, HELP_TERMS, termsWithin, type EmptyStateName, type HelpTermName } from "@/help-terms";

/**
 * Help in pages, with no chrome (#343, ADR-0035). A glossary term's first mention on a page opens its Help Article in
 * the Coach Panel; every later mention, and every mention outside a Coach Panel with help, is plain text.
 *
 *   <HelpTerm term="followUp">{t("followUps.noticesTitle")}</HelpTerm>        // the whole text names the term
 *   <HelpText terms={{ planQuota: t("helpTerms.words.planQuota") }}>{t("billing.quotaReached.renews")}</HelpText>
 *
 * The button reads as text with a dotted accent underline; its accessible name is the words and « (aide) ». Never put
 * one in a Section's own heading: the Top Bar says it, and the heading is only there for screen readers.
 */
export function HelpTerm({ term, children }: { term: HelpTermName; children: string }) {
  const { t } = useTranslation();
  const help = usePageHelp();
  const mentions = help?.mentions;
  const pathname = usePathname();
  const mention = useId();
  // Asked while rendering, so the server and the browser agree on which mention is the first.
  const first = mentions ? mentions.isFirst(pathname, term, mention) : false;
  useEffect(() => {
    if (!mentions) return;
    // Mounted again (React's strict mode, or a mention shown anew): it takes its place back if it is still free.
    mentions.isFirst(pathname, term, mention);
    return () => mentions.forget(term, mention);
  }, [mentions, pathname, term, mention]);

  if (!help || !first) return children;
  return (
    <button type="button" className="help-term" aria-label={`${children} ${t("helpTerms.suffix")}`} onClick={() => help.openHelp(HELP_TERMS[term])}>
      {children}
    </button>
  );
}

/**
 * A sentence naming glossary terms, each given by its words in the Interface Language: every term named is a HelpTerm.
 * Words the sentence does not contain (a language that words it otherwise) leave it plain.
 */
export function HelpText({ terms, children }: { terms: Partial<Record<HelpTermName, string>>; children: string }) {
  return termsWithin(children, terms).map((piece, index) =>
    typeof piece === "string" ? (
      <Fragment key={index}>{piece}</Fragment>
    ) : (
      <HelpTerm key={index} term={piece.term}>
        {piece.words}
      </HelpTerm>
    ),
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
