import Link from "next/link";
import { getServerT, getUrlLocale } from "@/i18n/server";
import { localePath } from "@/public-pages/public-shell";
import { routes } from "@/routes";

export type LandingAudienceName = "candidate" | "coach";

const ADDRESS = { candidate: routes.home, coach: routes.humanCoachLanding } as const;
const AUDIENCES = ["candidate", "coach"] as const;
const CURRENT_PAGE = "page";

/**
 * « Candidat | Coach humain » (ADR-0105): the two audiences of the public site, each at its own address, the page's own
 * marked as current. Plain links: each path can be shared and indexed by itself. Drawn only while the Human Coaches'
 * path is switched on.
 */
export async function LandingAudience({ current }: { current: LandingAudienceName }) {
  const t = await getServerT();
  const locale = await getUrlLocale();
  return (
    <nav className="landing-audience" aria-label={t("landing.coachPath.audience.label")}>
      {AUDIENCES.map((audience) => (
        <Link key={audience} href={localePath(ADDRESS[audience], locale)} aria-current={audience === current ? CURRENT_PAGE : undefined}>
          {t(`landing.coachPath.audience.${audience}`)}
        </Link>
      ))}
    </nav>
  );
}

/** The two doors before the page's end: the page's own audience, and the way across to the other. */
export async function LandingDoors({ current }: { current: LandingAudienceName }) {
  const t = await getServerT();
  const locale = await getUrlLocale();
  return (
    <section className="landing-section">
      <div className="landing-doors">
        {AUDIENCES.map((audience) =>
          audience === current ? (
            <div key={audience} className="landing-door" data-current="">
              <strong className="landing-h3">{t(`landing.coachPath.doors.${audience}.title`)}</strong>
              <span className="landing-body">{t(`landing.coachPath.doors.${audience}.text`)}</span>
            </div>
          ) : (
            <Link key={audience} className="landing-door" href={localePath(ADDRESS[audience], locale)}>
              <strong className="landing-h3">{t(`landing.coachPath.doors.${audience}.title`)}</strong>
              <span className="landing-body">{t(`landing.coachPath.doors.${audience}.text`)}</span>
              <span className="landing-door__link">{t(`landing.coachPath.doors.${audience}.link`)}</span>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
