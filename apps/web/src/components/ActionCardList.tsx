"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyStateHelp, HelpText } from "@/components/HelpTerm";

/** What the page needs to show one Action Card. */
export interface ActionCardView {
  id: string;
  title: string;
  body: string;
  /** Shown above the title, e.g. "Conseil senior". */
  label?: string;
  /** In place of the usual "Accepter", e.g. "Marquer comme envoyée". */
  acceptLabel?: string;
  /** In place of the usual "Ignorer", e.g. "Ignorer ce conseil". */
  dismissLabel?: string;
  /** Shown below the body, e.g. what accepting does. */
  hint?: string;
  /** The body is a draft the Candidate sends themselves (e.g. a Follow-up): set apart as one, with a button to copy it. */
  draft?: boolean;
}

/** The heading of the page's Action Cards, while there are some. */
const TITLE_ID = "action-cards-title";

/**
 * Brings the page's Action Cards into view and moves focus to them, e.g. once
 * a computation elsewhere on the page has proposed new ones, which would
 * otherwise appear out of sight. False when the page shows no Action Cards.
 */
export function bringActionCardsIntoView(): boolean {
  const title = document.getElementById(TITLE_ID);
  if (!title) return false;
  title.scrollIntoView({ block: "start" });
  title.focus({ preventScroll: true });
  return true;
}

type Outcome = { kind: "accepted" | "dismissed" } | { kind: "error"; cardId: string };

/**
 * The AI Coach's pending Action Cards for what this page shows. The Candidate
 * accepts or dismisses each one; a decided card leaves the page. Accepting one
 * changes what the page shows, so the page is then refreshed (new cards the
 * page receives appear). `alone`: the list is its page's Propositions Section, which says
 * so when it has none, with a link to the help (#343); elsewhere a list without cards shows nothing.
 */
export function ActionCardList({ cards: shown, alone = false }: { cards: ActionCardView[]; alone?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const cards = shown.filter((card) => !decided.has(card.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState<{ cardId: string; ok: boolean } | null>(null);

  async function copy(card: ActionCardView) {
    try {
      await navigator.clipboard.writeText(card.body);
      setCopied({ cardId: card.id, ok: true });
    } catch {
      setCopied({ cardId: card.id, ok: false });
    }
  }

  async function decide(card: ActionCardView, decision: "accept" | "dismiss") {
    setBusy(card.id);
    setOutcome(null);
    try {
      const response = await fetch(`/api/action-cards/${card.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      // Already decided elsewhere (another tab): it is off the page either way.
      if (response.ok || response.status === 409 || response.status === 404) {
        setDecided((current) => new Set(current).add(card.id));
        if (response.ok) setOutcome({ kind: decision === "accept" ? "accepted" : "dismissed" });
        if (response.ok && decision === "accept") router.refresh();
      } else {
        setOutcome({ kind: "error", cardId: card.id });
      }
    } catch {
      setOutcome({ kind: "error", cardId: card.id });
    } finally {
      setBusy(null);
    }
  }

  if (cards.length === 0 && !outcome && !alone) return null;
  return (
    <section className="action-cards stack" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID} tabIndex={-1}>
        {t("actionCards.title")}
      </h2>
      {cards.length > 0 ? (
        <p className="hint">
          <HelpText terms={{ proposals: t("helpTerms.words.proposals") }}>{t("actionCards.intro")}</HelpText>
        </p>
      ) : null}
      {outcome && outcome.kind !== "error" ? (
        <p className="notice" role="status">
          {t(`actionCards.${outcome.kind}`)}
        </p>
      ) : null}
      {alone && cards.length === 0 ? (
        <p>
          {t("actionCards.none")} <EmptyStateHelp of="proposals" />
        </p>
      ) : null}
      {cards.map((card) => (
        <article key={card.id} className="action-card" aria-labelledby={`action-card-${card.id}`}>
          {card.label ? <p className="action-card-label">{card.label}</p> : null}
          <h3 id={`action-card-${card.id}`}>{card.title}</h3>
          <p className={card.draft ? "draft" : "cv-text"}>{card.body}</p>
          {card.hint ? <p className="hint">{card.hint}</p> : null}
          {outcome?.kind === "error" && outcome.cardId === card.id ? (
            <p className="field-error" role="alert">
              {t("actionCards.error")}
            </p>
          ) : null}
          <div className="actions">
            <button className="button button-primary" type="button" disabled={busy === card.id} onClick={() => decide(card, "accept")}>
              {card.acceptLabel ?? t("actionCards.accept")}
            </button>
            {card.draft ? (
              <button className="button" type="button" onClick={() => copy(card)}>
                {t("actionCards.copyDraft")}
              </button>
            ) : null}
            <button className="button button-quiet" type="button" disabled={busy === card.id} onClick={() => decide(card, "dismiss")}>
              {card.dismissLabel ?? t("actionCards.dismiss")}
            </button>
          </div>
          {copied?.cardId === card.id ? (
            copied.ok ? (
              <p role="status">{t("actionCards.copied")}</p>
            ) : (
              <p className="field-error" role="alert">
                {t("actionCards.copyFailed")}
              </p>
            )
          ) : null}
        </article>
      ))}
    </section>
  );
}
