import Link from "next/link";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { JobOfferCard } from "@/coach/conversation";
import { buttonClass } from "@/design/button-class";
import { Pill } from "@/design/Pill";
import { routes } from "@/routes";
import "./CoachJobOfferCard.css";

/**
 * A Job Offer card in the thread (#267): the Job Offer an AI Coach reply read from a pasted link, linking to its page,
 * where the Candidate processes it. Drawn with the Design System alone, as the Coach proposals' Action Cards are (#788):
 * a Card (its border, radius and shadow, no edge of its own), its title in the card's head, the employer in the
 * secondary text colour, its state a Pill (« À traiter » in the accent, « Suivie » in success: said in words, never by
 * colour alone, ADR-0009), and « Ouvrir l'offre » a small secondary Button, as on the Job Offer cards of Recherches
 * d'offres (#467).
 */
export function CoachJobOfferCard({ jobOffer }: { jobOffer: JobOfferCard }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <article className="ds-card coach-job-offer-card" aria-label={t("coachPanel.jobOfferLink.card")}>
      <div className="ds-card__head">
        <h4 className="ds-card__title coach-job-offer-card__title" id={titleId}>
          {jobOffer.title}
        </h4>
      </div>
      {jobOffer.employer ? <p className="coach-job-offer-card__employer">{jobOffer.employer}</p> : null}
      <Pill tone={jobOffer.followed ? "success" : "accent"}>
        {t(jobOffer.followed ? "coachPanel.jobOfferLink.followed" : "coachPanel.jobOfferLink.toProcess")}
      </Pill>
      <Link className={buttonClass({ size: "sm" })} href={routes.jobOffer(jobOffer.id)} aria-describedby={titleId}>
        {t("coachPanel.jobOfferLink.open")}
      </Link>
    </article>
  );
}
