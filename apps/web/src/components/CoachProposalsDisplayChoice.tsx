"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { COACH_PROPOSALS_DISPLAYS, readCoachProposalsDisplay, type CoachProposalsDisplay } from "@/coach-proposals-display/choice";
import { SegmentedControl } from "@/design/Field";
import { Note } from "@/design/Note";

/**
 * « Propositions du coach » in Mon compte › Préférences (#717, ADR-0077): what a Coach Action's proposal shows first,
 * « Carte » (the default) or « Formulaire » (its form opened by itself in the Work Pane). Kept with the account, saved as
 * soon as it changes (shown at once, put back when it could not be saved).
 */
export function CoachProposalsDisplayChoice({ display: initial }: { display: CoachProposalsDisplay }) {
  const { t } = useTranslation();
  const [display, setDisplay] = useState(initial);
  const [saved, setSaved] = useState<CoachProposalsDisplay | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(next: CoachProposalsDisplay) {
    if (next === display) return;
    const before = display;
    setDisplay(next);
    setSaved(null);
    setFailed(false);
    try {
      const response = await fetch("/api/account/coach-proposals-display", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const kept = readCoachProposalsDisplay(((await response.json()) as { display?: unknown }).display);
      setDisplay(kept);
      setSaved(kept);
    } catch {
      setDisplay(before);
      setFailed(true);
    }
  }

  return (
    <div className="theme-choice stack">
      <span className="theme-choice-label" aria-hidden="true">
        {t("coachProposalsDisplay.label")}
      </span>
      <SegmentedControl
        label={t("coachProposalsDisplay.label")}
        value={display}
        onValueChange={(value) => void choose(value)}
        options={COACH_PROPOSALS_DISPLAYS.map((value) => ({ value, label: t(`coachProposalsDisplay.${value}`) }))}
      />
      <p className="theme-choice-hint">{t("coachProposalsDisplay.hint")}</p>
      <p role="status" className="account-status">
        {saved ? t(`coachProposalsDisplay.saved.${saved}`) : ""}
      </p>
      {failed ? (
        <Note tone="danger" role="alert">
          {t("coachProposalsDisplay.error")}
        </Note>
      ) : null}
    </div>
  );
}
