"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

/** What the page needs to show one Action Card. */
export interface ActionCardView {
  id: string;
  title: string;
  body: string;
}

type Outcome = { kind: "accepted" | "dismissed" } | { kind: "error"; cardId: string };

/**
 * The AI Coach's pending Action Cards for what this page shows. The Candidate
 * accepts or dismisses each one; a decided card leaves the page.
 */
export function ActionCardList({ cards: initial }: { cards: ActionCardView[] }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState(initial);
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
        setCards((current) => current.filter((other) => other.id !== card.id));
        if (response.ok) setOutcome({ kind: decision === "accept" ? "accepted" : "dismissed" });
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
          <h3 id={`action-card-${card.id}`}>{card.title}</h3>
          <p className="cv-text">{card.body}</p>
          {outcome?.kind === "error" && outcome.cardId === card.id ? (
            <p className="field-error" role="alert">
              {t("actionCards.error")}
            </p>
          ) : null}
          <div className="actions">
            <button className="button button-primary" type="button" disabled={busy === card.id} onClick={() => decide(card, "accept")}>
              {t("actionCards.accept")}
            </button>
            <button className="button" type="button" disabled={busy === card.id} onClick={() => decide(card, "dismiss")}>
              {t("actionCards.dismiss")}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
