"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";

/**
 * The Candidate's Nouveautés email (#566), in Mon compte's Préférences: « Recevoir un e-mail quand Jobbbox annonce une
 * nouveauté ». Never ticked by default; ticked, it says since when (the consent's date). Saved as soon as it changes
 * (shown at once, put back when it could not be saved).
 */
export function NouveautesEmailForm({ subscribedAt: initial }: { subscribedAt: string | null }) {
  const { t, i18n } = useTranslation();
  const [subscribedAt, setSubscribedAt] = useState(initial);
  const [subscribed, setSubscribed] = useState(initial !== null);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setSubscribed(next);
    setWorking(true);
    setFailed(false);
    setSaved(false);
    try {
      const response = await fetch("/api/account/nouveautes-email", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscribed: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const setting = (await response.json()) as { subscribed: boolean; subscribedAt: string | null };
      setSubscribed(setting.subscribed);
      setSubscribedAt(setting.subscribedAt);
      setSaved(true);
    } catch {
      setSubscribed(!next);
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  const since =
    subscribed && subscribedAt
      ? t("nouveautesEmail.settings.since", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(subscribedAt)) })
      : null;
  return (
    <div className="stack">
      <Checkbox
        label={t("nouveautesEmail.settings.label")}
        hint={since ? `${t("nouveautesEmail.settings.explanation")} ${since}` : t("nouveautesEmail.settings.explanation")}
        checked={subscribed}
        disabled={working}
        onChange={(event) => void change(event.target.checked)}
      />
      <p role="status" className="account-status">
        {saved ? t(subscribed ? "nouveautesEmail.settings.on" : "nouveautesEmail.settings.off") : ""}
      </p>
      {failed ? (
        <Note tone="danger" role="alert">
          {t("nouveautesEmail.settings.error")}
        </Note>
      ) : null}
    </div>
  );
}
