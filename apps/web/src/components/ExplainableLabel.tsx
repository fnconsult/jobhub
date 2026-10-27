"use client";

import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ExplainedItem } from "@/back-office-assistant/conversation";
import { useAskAssistant } from "@/components/CoachPanel";

/** What a page says of the item an Explainable label explains; the label's words and the page are added here. */
export type ExplainedContext = Omit<ExplainedItem, "label" | "page">;

/** The item with only what the page says of it: a field it leaves empty is not sent (a value may be empty: none is set). */
const told = (item: ExplainedItem): ExplainedItem =>
  Object.fromEntries(Object.entries(item).filter(([name, value]) => value !== undefined && (name === "value" || value !== ""))) as unknown as ExplainedItem;

/**
 * An Explainable label (#407, ADR-0042): a setting's, source's, warning's or figure's label in the Back Office, with the
 * look of a HelpTerm (dotted underline, inline target, focus ring). A click opens the Back Office Assistant and sends
 * « Explique-moi « <label> » ici. » with `item`, what the page shows of it (its value, source, state), and the page.
 *
 *   <ExplainableLabel item={{ kind: "setting", id: "JOB_DISCOVERY_COUNTRY", value: "FR", source: "Défaut du code" }}>Pays</ExplainableLabel>
 *   <ExplainableLabel subject={warning} item={{ kind: "warning", id: "key_missing" }}>Pourquoi ?</ExplainableLabel>
 *
 * Its accessible name is its words; `subject` is what it explains when the words are not its name (« Pourquoi ? » after
 * a warning). `code`: the words are a name in code, shown as such. Outside the Back Office Assistant it is plain text.
 * Never give it a Provider Secret's value or an email address (the assistant drops them anyway).
 */
export function ExplainableLabel({ item, subject, code = false, describedBy, children }: { item: ExplainedContext; subject?: string; code?: boolean; describedBy?: string; children: string }) {
  const { t } = useTranslation();
  const ask = useAskAssistant();
  const page = usePathname();
  const words = code ? <code>{children}</code> : children;
  if (!ask) return words;
  const label = subject ?? children;
  return (
    <button type="button" className="help-term explainable-label" aria-describedby={describedBy} onClick={() => ask(t("backOfficeAssistant.explain.question", { label }), told({ ...item, label, page }))}>
      {words}
    </button>
  );
}
