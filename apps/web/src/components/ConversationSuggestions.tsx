"use client";

import { useAskCoach } from "@/components/CoachConversationPage";
import { buttonClass } from "@/design/button-class";
import "./QuickActions.css";

/** A suggestion above the box: its words on the button, and the message it sends. */
export type ConversationSuggestion = { label: string; message: string };

/**
 * The suggestions of an object's conversation (#603, ADR-0070), above its box while nothing is sent: each sends its
 * message to the AI Coach in the page's conversation (« Préparer l'entretien », « Rédiger une relance »…). Nothing outside
 * a page that is a conversation.
 */
export function ConversationSuggestions({ suggestions }: { suggestions: readonly ConversationSuggestion[] }) {
  const ask = useAskCoach();
  if (!ask) return null;
  return (
    <div className="quick-actions">
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.label}
          className={buttonClass({ variant: index === 0 ? "primary" : "secondary", size: "sm" })}
          type="button"
          onClick={() => ask(suggestion.message)}
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
