"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
}

type Outcome = { kind: "accepted" | "dismissed" } | { kind: "error"; cardId: string };

/**
 * The AI Coach's pending Action Cards for what this page shows. The Candidate
 * accepts or dismisses each one; a decided card leaves the page. Accepting one
 * changes what the page shows, so the page is then refreshed (new cards the
 * page receives appear).
 */
export function ActionCardList({ cards: shown }: { cards: ActionCardView[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const cards = shown.filter((card) => !decided.has(card.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

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

  if (cards.length === 0 && !outcome) return null;
  return (
    <section className="action-cards stack" aria-labelledby="action-cards-title">
      <h2 id="action-cards-title">{t("actionCards.title")}</h2>
      {outcome && outcome.kind !== "error" ? (
        <p className="notice" role="status">
          {t(`actionCards.${outcome.kind}`)}
        </p>
      ) : null}
      {cards.map((card) => (
        <article key={card.id} className="action-card" aria-labelledby={`action-card-${card.id}`}>
          {card.label ? <p className="action-card-label">{card.label}</p> : null}
          <h3 id={`action-card-${card.id}`}>{card.title}</h3>
          <p className="cv-text">{card.body}</p>
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
            <button className="button" type="button" disabled={busy === card.id} onClick={() => decide(card, "dismiss")}>
              {card.dismissLabel ?? t("actionCards.dismiss")}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
