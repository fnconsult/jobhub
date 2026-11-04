"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { helpCentreAddress, type HelpArticle } from "@/coach-help";
import { VIDEO_ANCHOR, videoDuration } from "@/help-media/format";

/** The published videos' durations by language, asked once per page (`/api/help-videos`). */
const asked = new Map<string, Promise<Record<string, number>>>();

function durations(locale: string): Promise<Record<string, number>> {
  let found = asked.get(locale);
  if (!found) {
    found = fetch(`/api/help-videos?locale=${locale}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ durations: Record<string, number> }>) : { durations: {} }))
      .then((body) => body.durations ?? {})
      .catch(() => {
        asked.delete(locale);
        return {};
      });
    asked.set(locale, found);
  }
  return found;
}

/**
 * « Voir la vidéo (durée) » on the card of a Tutorial whose Explainer Video is published in its language (#568, ADR-0066):
 * a link to the Tutorial's page in the Help Centre, at its video. No video plays in the Coach Panel. Nothing for any
 * other article, nor while the video is not published.
 */
export function WatchVideo({ article }: { article: HelpArticle }) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState<number | null>(null);
  const page = helpCentreAddress(article);
  useEffect(() => {
    if (!article.motion || !page) return;
    let current = true;
    void durations(article.locale).then((found) => {
      if (current) setSeconds(found[article.motion!] ?? null);
    });
    return () => {
      current = false;
    };
  }, [article.motion, article.locale, page]);
  if (!page || seconds === null) return null;
  const duration = videoDuration(seconds);
  return (
    <p className="help-card-open">
      <a href={`${page}#${VIDEO_ANCHOR}`} aria-label={t("coachPanel.help.watchVideoAbout", { duration, title: article.title })} data-watch-video>
        {t("coachPanel.help.watchVideo", { duration })}
      </a>
    </p>
  );
}
