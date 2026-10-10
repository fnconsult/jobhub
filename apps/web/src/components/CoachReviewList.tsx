import type { CoachReview } from "@/human-coaches";
import { getRequestLocale, getServerT } from "@/i18n/server";

/** The Coach Reviews of an Application, oldest first; nothing when there are none. */
export async function CoachReviewList({ reviews }: { reviews: CoachReview[] }) {
  if (reviews.length === 0) return null;
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });
  return (
    <section className="stack" aria-labelledby="coach-reviews-title">
      <h2 id="coach-reviews-title">{t("coachReviews.title")}</h2>
      <ul className="stack">
        {reviews.map((review) => (
          <li key={review.id} className="stack">
            <h3>{t(`coachReviews.documents.${review.document}`)}</h3>
            <p className="cv-text">{review.text}</p>
            <p className="hint">{t("coachReviews.by", { name: review.coach.name, date: date.format(review.createdAt) })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
