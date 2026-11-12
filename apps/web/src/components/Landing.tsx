import Link from "next/link";
import { ExternalLink } from "@/components/ExternalLink";
import { buttonClass } from "@/design/button-class";
import { Logo } from "@/design/Logo";
import { getServerT, getUrlLocale } from "@/i18n/server";
import type { LandingPlan, LandingStoreLinks } from "@/landing";
import { localePath } from "@/public-pages/public-shell";
import { routes } from "@/routes";
import { ApplicationScreen, AppScreen, ConversationScreen, ExtensionScreen, FollowUpScreen, OffersScreen } from "./LandingScreens";
import { LandingAudience, LandingDoors } from "./LandingAudience";
import { LandingStory } from "./LandingStory";
import "./Landing.css";

const STEPS = ["cv", "offers", "application", "followUp"] as const;
const QUESTIONS = ["person", "data", "install", "signIn", "stop"] as const;

/** « Quelles sont les offres de Jobbbox, et leurs quotas ? », the Help Article the Plans lead to. */
const PLANS_ARTICLE = routes.helpArticle("decouvrir", "faq-plans-and-quotas");

/**
 * The landing page (ADR-0105), inside the public shell: one idea, the product under it, one action; then the method as
 * a story read by scrolling, the coach's own first message, the extension and the app, the Human Coaches, the Plans as
 * the Back Office offers them, the questions, and the same action again. `plans`: none, the section is left out.
 * `stores`: a store whose page Paramètres does not set has no link. `coachPath`: the Human Coaches' path is switched on,
 * so the page opens with « Candidat | Coach humain » and shows the two doors before its end. Its links keep the URL's
 * language (`/en`).
 */
export async function Landing({ plans, stores, coachPath = false }: { plans: readonly LandingPlan[]; stores: LandingStoreLinks; coachPath?: boolean }) {
  const t = await getServerT();
  const locale = await getUrlLocale();
  const href = (path: string) => localePath(path, locale);
  const screens = { cv: <ConversationScreen />, offers: <OffersScreen />, application: <ApplicationScreen />, followUp: <FollowUpScreen /> };
  const action = (
    <Link className={`${buttonClass({ variant: "primary" })} landing-action`} href={href(routes.signIn)}>
      {t("landing.cta")}
    </Link>
  );
  return (
    <main id="main" className="landing">
      <section className="landing-hero">
        {coachPath ? <LandingAudience current="candidate" /> : null}
        <h1 className="landing-display">{t("landing.hero.title")}</h1>
        <p className="landing-lead">{t("landing.hero.lead")}</p>
        <div className="landing-hero__action">
          {action}
          <span className="landing-meta">{t("landing.free")}</span>
        </div>
        <div className="landing-stage landing-hero__stage">
          <ConversationScreen fiche />
        </div>
      </section>

      <section className="landing-section" id="methode" aria-labelledby="landing-method">
        <div className="landing-head">
          <p className="landing-eyebrow">{t("landing.method.eyebrow")}</p>
          <h2 className="landing-h2" id="landing-method">
            {t("landing.method.title")}
          </h2>
          <p className="landing-lead">{t("landing.method.lead")}</p>
        </div>
        <LandingStory
          steps={STEPS.map((step) => ({
            id: step,
            label: t(`landing.method.steps.${step}.label`),
            title: t(`landing.method.steps.${step}.title`),
            text: t(`landing.method.steps.${step}.text`),
            screen: screens[step],
          }))}
        />
      </section>

      <section className="landing-section landing-quote" aria-labelledby="landing-coach">
        <p className="landing-eyebrow" id="landing-coach">
          {t("landing.coach.eyebrow")}
        </p>
        <figure>
          <blockquote className="landing-quote__words">{t("landing.coach.quote")}</blockquote>
          <figcaption className="landing-meta">{t("landing.coach.source")}</figcaption>
        </figure>
        <p className="landing-body">{t("landing.coach.text")}</p>
      </section>

      <section className="landing-section" aria-labelledby="landing-tools">
        <div className="landing-head">
          <p className="landing-eyebrow">{t("landing.tools.eyebrow")}</p>
          <h2 className="landing-h2" id="landing-tools">
            {t("landing.tools.title")}
          </h2>
        </div>
        <div className="landing-duo">
          <div className="landing-stage landing-tile">
            <div className="landing-tile__text">
              <h3 className="landing-h3">{t("landing.tools.extension.title")}</h3>
              <p className="landing-body">{t("landing.tools.extension.text")}</p>
              {stores.extension ? (
                <p>
                  <ExternalLink className="landing-link" href={stores.extension}>
                    {t("landing.tools.extension.install")}
                  </ExternalLink>
                </p>
              ) : null}
            </div>
            <ExtensionScreen />
          </div>
          <div className="landing-stage landing-tile">
            <div className="landing-tile__text">
              <h3 className="landing-h3">{t("landing.tools.app.title")}</h3>
              <p className="landing-body">{t("landing.tools.app.text")}</p>
              {stores.appStore || stores.playStore ? (
                <p className="landing-links">
                  {stores.appStore ? (
                    <ExternalLink className="landing-link" href={stores.appStore}>
                      {t("landing.tools.app.appStore")}
                    </ExternalLink>
                  ) : null}
                  {stores.playStore ? (
                    <ExternalLink className="landing-link" href={stores.playStore}>
                      {t("landing.tools.app.playStore")}
                    </ExternalLink>
                  ) : null}
                </p>
              ) : null}
            </div>
            <AppScreen />
          </div>
        </div>
      </section>

      <section className="landing-section landing-pair">
        <div>
          <p className="landing-eyebrow">{t("landing.humans.eyebrow")}</p>
          <h2 className="landing-h3" id="landing-humans">
            {t("landing.humans.title")}
          </h2>
          <p className="landing-body">{t("landing.humans.text")}</p>
          <p className="landing-body">{t("landing.humans.more")}</p>
        </div>
        <div>
          <p className="landing-eyebrow">{t("landing.reading.eyebrow")}</p>
          <h2 className="landing-h3" id="landing-reading">
            {t("landing.reading.title")}
          </h2>
          <p className="landing-body">{t("landing.reading.text")}</p>
        </div>
      </section>

      {plans.length > 0 ? (
        <section className="landing-section" aria-labelledby="landing-plans">
          <div className="landing-head">
            <p className="landing-eyebrow">{t("landing.plans.eyebrow")}</p>
            <h2 className="landing-h2" id="landing-plans">
              {t("landing.plans.title")}
            </h2>
          </div>
          <div className="landing-plans">
            {plans.map((plan) => (
              <div key={plan.key} className="landing-plan">
                <h3 className="landing-h3">{plan.name}</h3>
                {plan.price ? <p className="landing-plan__price">{plan.price}</p> : null}
                {plan.lines.length > 0 ? (
                  <ul className="landing-plan__lines">
                    {plan.lines.map((line) => (
                      <li key={line.label} data-included={line.included ? "" : undefined}>
                        <span>{line.label}</span>
                        <span>{line.included ? line.value : t("landing.plans.notIncluded")}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
          <p className="landing-body landing-plans__note">
            {t("landing.plans.note")}{" "}
            <Link className="landing-link" href={href(PLANS_ARTICLE)}>
              {t("landing.plans.detail")}
            </Link>
          </p>
        </section>
      ) : null}

      <section className="landing-section landing-narrow" aria-labelledby="landing-questions">
        <div className="landing-head" data-align="start">
          <p className="landing-eyebrow">{t("landing.questions.eyebrow")}</p>
          <h2 className="landing-h2" id="landing-questions">
            {t("landing.questions.title")}
          </h2>
        </div>
        <div className="landing-questions">
          {QUESTIONS.map((question) => (
            <details key={question}>
              <summary>{t(`landing.questions.${question}.question`)}</summary>
              <p className="landing-body">{t(`landing.questions.${question}.answer`)}</p>
            </details>
          ))}
        </div>
        <p>
          <Link className="landing-link" href={href(routes.help)}>
            {t("landing.questions.more")}
          </Link>
        </p>
      </section>

      {coachPath ? <LandingDoors current="candidate" /> : null}

      <section className="landing-end" aria-labelledby="landing-end">
        <span className="landing-end__logo">
          <Logo />
        </span>
        <h2 className="landing-h2" id="landing-end">
          {t("landing.end.title")}
        </h2>
        <p className="landing-lead">{t("landing.end.lead")}</p>
        {action}
      </section>
    </main>
  );
}
