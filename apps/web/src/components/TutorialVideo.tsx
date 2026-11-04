import type { HelpArticle } from "@jobhub/help";
import { MotionVideo } from "@/components/MotionVideo";
import { isoDuration, VIDEO_ANCHOR, videoDuration } from "@/help-media";
import { tutorialVideo } from "@/help-media/server";
import { getServerT } from "@/i18n/server";

/** The player's name: the section's title and its duration line. */
const LABELLED_BY = ["help-video-title", "help-video-duration"].join(" ");

/**
 * A Tutorial's Explainer Video in the Help Centre (ADR-0066, #568), under its text, which reads complete without it: the
 * player, its duration, and the descriptive transcript to unfold (« Voix de synthèse »). Nothing at all while no video
 * is published in the page's language: no gap, no notice.
 */
export async function TutorialVideo({ article }: { article: HelpArticle }) {
  const found = await tutorialVideo(article);
  if (!found) return null;
  const t = await getServerT(article.locale);
  const { video, transcript } = found;
  const duration = videoDuration(video.duration);
  return (
    <section className="help-video" id={VIDEO_ANCHOR} aria-labelledby="help-video-title">
      <h2 id="help-video-title">{t("helpCentre.video.title")}</h2>
      <figure className="help-video__figure">
        <MotionVideo
          video={video.video}
          poster={video.poster}
          captions={video.captions}
          locale={video.locale}
          captionsLabel={t(`helpCentre.video.captions.${video.locale}`)}
          unsupported={t("helpCentre.video.unsupported")}
          labelledBy={LABELLED_BY}
        />
        <figcaption className="help-video__meta" id="help-video-duration">
          {t("helpCentre.video.duration")} <time dateTime={isoDuration(video.duration)}>{duration}</time>
          {" · "}
          {t("helpCentre.video.voice")}
        </figcaption>
      </figure>
      <details className="help-video__transcript">
        <summary>{t("helpCentre.video.transcript")}</summary>
        <p>{t("helpCentre.video.syntheticVoice")}</p>
        {transcript.map((step, index) => (
          <section key={index}>
            <h3>{step.title}</h3>
            {step.paragraphs.map((paragraph, at) => (
              <p key={at}>{paragraph}</p>
            ))}
          </section>
        ))}
      </details>
    </section>
  );
}
