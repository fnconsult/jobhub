"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Note } from "@/design/Note";
import type { PrivacyChange } from "@/legal-text-notices";
import { writtenDay } from "@/public-pages/days";

/**
 * Tells the signed-in Candidate, atop every page of their workspace, that the privacy policy changed (a substantial
 * version now in effect, #547, ADR-0062): « Notre politique de confidentialité a changé le <date> », the link to it and
 * « J'ai compris ». Information, never a consent: no box, nothing blocked. Closed, it is never shown again for that
 * version, on any device.
 */
export function PrivacyChangeNotice({ change }: { change: PrivacyChange }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);
  if (!open) return null;
  function dismiss() {
    setOpen(false);
    void fetch(`/api/privacy-change/${encodeURIComponent(change.version)}`, { method: "DELETE" }).catch(() => undefined);
  }
  return (
    <section className="privacy-change-notice" aria-label={t("privacyChange.label")}>
      <Note>
        <p>{t("privacyChange.message", { date: writtenDay(change.version, i18n.language) })}</p>
        <div className="actions">
          <Link className="button" href={change.url}>
            {t("privacyChange.read")}
          </Link>
          <button className="button button-primary" type="button" onClick={dismiss}>
            {t("privacyChange.dismiss")}
          </button>
        </div>
      </Note>
    </section>
  );
}
