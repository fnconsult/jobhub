import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/design/button-class";
import { Logo } from "@/design/Logo";
import { Pill, Status } from "@/design/Pill";
import { getServerT, getUrlLocale } from "@/i18n/server";
import { COACH_ENROLMENT_PATH } from "@/landing";
import { localePath } from "@/public-pages/public-shell";
import { LandingAudience, LandingDoors } from "./LandingAudience";
import { LandingStory } from "./LandingStory";
import "./Landing.css";

const STEPS = ["request", "profile", "sessions", "earnings"] as const;
const QUESTIONS = ["who", "price", "paid", "reviews", "where"] as const;
/** « Étape n sur 4 »: the same labels as the Candidate's four steps, by position. */
const STEP_LABELS = ["cv", "offers", "application", "followUp"] as const;
type CoachNav = "today" | "candidates" | "sessions" | "availability" | "profile" | "earnings" | "contract";
const EARNING_LINES = ["held", "collected", "commission"] as const;
const NAV: readonly CoachNav[] = ["today", "candidates", "sessions", "availability", "profile", "earnings", "contract"];

/** Lines of text drawn as bars. */
function Lines({ widths }: { widths: readonly number[] }) {
  return (
    <>
      {widths.map((width, index) => (
        <i key={index} className="landing-line" style={{ width: `${width}%` }} />
      ))}
    </>
  );
}

/** The coach space's frame: its own Sidebar, the page's title, then the page. A picture, read out as one image. */
async function CoachFrame({ title, current, alt, children }: { title: string; current?: CoachNav; alt: string; children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className="landing-app" data-plain={current ? undefined : ""} role="img" aria-label={alt}>
      {current ? (
        <div className="landing-app__side" aria-hidden="true">
          <span className="landing-app__brand">
            <Logo />
            {t("app.name")}
          </span>
          {NAV.map((item) => (
            <span key={item} className="landing-app__nav" data-current={item === current ? "" : undefined}>
              {t(`landing.coachPath.screens.nav.${item}`)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="landing-app__main" aria-hidden="true">
        <div className="landing-app__bar">
          <strong>{title}</strong>
          <span className="landing-meta">{t("landing.example")}</span>
        </div>
        <div className="landing-app__body">{children}</div>
      </div>
    </div>
  );
}

/** « Devenir coach sur Jobbbox »: the request form, with example answers. */
async function RequestScreen() {
  const t = await getServerT();
  return (
    <CoachFrame title={t("landing.coachPath.cta")} alt={t("landing.coachPath.screens.request.alt")}>
      <div className="landing-field">
        <span className="landing-meta">{t("landing.coachPath.screens.request.represents")}</span>
        <div className="landing-choices">
          <span data-chosen="">{t("landing.coachPath.screens.request.independent")}</span>
          <span>{t("landing.coachPath.screens.request.association")}</span>
        </div>
      </div>
      <div className="landing-field">
        <span className="landing-meta">{t("landing.coachPath.screens.request.specialities")}</span>
        <span className="landing-input">{t("landing.coachPath.screens.request.specialitiesValue")}</span>
      </div>
      <div className="landing-field">
        <span className="landing-meta">{t("landing.coachPath.screens.request.languages")}</span>
        <span className="landing-input">{t("landing.coachPath.screens.request.languagesValue")}</span>
      </div>
      <div className="landing-field">
        <span className="landing-meta">{t("landing.coachPath.screens.request.proof")}</span>
        <span className="landing-drop">{t("landing.coachPath.screens.request.proofHint")}</span>
      </div>
      <span className="landing-browser__button">{t("landing.coachPath.screens.request.send")}</span>
    </CoachFrame>
  );
}

/** The Coach Page as Candidates see it: presentation, specialities, languages, a Coaching Offer and its Seller. */
async function ProfileScreen() {
  const t = await getServerT();
  return (
    <CoachFrame title={`${t("landing.coachPath.screens.nav.profile")} · ${t("landing.coachPath.screens.profile.preview")}`} current="profile" alt={t("landing.coachPath.screens.profile.alt")}>
      <div className="landing-coach-card__head">
        <span className="landing-avatar" />
        <div>
          <strong className="landing-doc__name">{t("landing.coachPath.screens.profile.name")}</strong>
          <br />
          <span className="landing-meta">{t("landing.coachPath.screens.profile.role")}</span>
        </div>
      </div>
      <div className="landing-chat__actions" data-flush="">
        <Pill>{t("landing.coachPath.screens.profile.careerChange")}</Pill>
        <Pill>{t("landing.coachPath.screens.profile.executives")}</Pill>
        <Pill>{t("landing.coachPath.screens.profile.interview")}</Pill>
      </div>
      <span className="landing-meta">{t("landing.coachPath.screens.profile.presentation")}</span>
      <Lines widths={[96, 88, 62]} />
      <div className="landing-row" data-boxed="">
        <div>
          <strong>{t("landing.coachPath.screens.profile.offer")}</strong>
          <br />
          <span className="landing-meta">{t("landing.coachPath.screens.profile.soldBy")}</span>
        </div>
        <Pill tone="accent">{t("landing.coachPath.screens.profile.price")}</Pill>
      </div>
      <span className="landing-browser__button">{t("landing.coachPath.screens.profile.book")}</span>
    </CoachFrame>
  );
}

/** A Coaching Session's page in the coach space: when, the video link, private preparation, Shared Reading, the Session Report. */
async function SessionScreen() {
  const t = await getServerT();
  return (
    <CoachFrame title={t("landing.coachPath.screens.session.title")} current="sessions" alt={t("landing.coachPath.screens.session.alt")}>
      <div className="landing-row" data-plain="">
        <span className="landing-meta">{t("landing.coachPath.screens.session.when")}</span>
        <span className="landing-browser__button">{t("landing.coachPath.screens.session.join")}</span>
      </div>
      <div className="landing-cards">
        <div className="landing-card">
          <strong>{t("landing.coachPath.screens.session.preparation")}</strong>
          <span className="landing-meta">{t("landing.coachPath.screens.session.private")}</span>
          <Lines widths={[92, 78, 50]} />
        </div>
        <div className="landing-card">
          <strong>{t("landing.coachPath.screens.session.sharedReading")}</strong>
          <span className="landing-meta">{t("landing.coachPath.screens.session.sharedReadingNote")}</span>
          <Lines widths={[84, 66]} />
        </div>
      </div>
      <div className="landing-card">
        <div className="landing-row" data-plain="">
          <strong>{t("landing.coachPath.screens.session.report")}</strong>
          <Pill tone="warn">{t("landing.coachPath.screens.session.draft")}</Pill>
        </div>
        <span className="landing-meta">{t("landing.coachPath.screens.session.covered")}</span>
        <Lines widths={[90, 72]} />
        <span className="landing-meta">{t("landing.coachPath.screens.session.nextSteps")}</span>
        <Lines widths={[80]} />
      </div>
    </CoachFrame>
  );
}

/** Revenus, for one month. The amounts are drawn as bars: no figure is made up, and none is promised. */
async function EarningsScreen() {
  const t = await getServerT();
  return (
    <CoachFrame title={t("landing.coachPath.screens.nav.earnings")} current="earnings" alt={t("landing.coachPath.screens.earnings.alt")}>
      <div className="landing-row" data-plain="">
        <span className="landing-input">{t("landing.coachPath.screens.earnings.month")}</span>
        <span className="landing-meta">{t("landing.coachPath.screens.earnings.masked")}</span>
      </div>
      <div className="landing-rows">
        {EARNING_LINES.map((line) => (
          <div key={line} className="landing-row">
            <span>{t(`landing.coachPath.screens.earnings.${line}`)}</span>
            <i className="landing-amount" />
          </div>
        ))}
        <div className="landing-row">
          <strong>{t("landing.coachPath.screens.earnings.net")}</strong>
          <i className="landing-amount" data-strong="" />
        </div>
        <div className="landing-row">
          <span>{t("landing.coachPath.screens.earnings.payout")}</span>
          <Status>{t("landing.coachPath.screens.earnings.scheduled")}</Status>
        </div>
      </div>
      <span className="landing-link">{t("landing.coachPath.screens.earnings.statement")}</span>
    </CoachFrame>
  );
}

/**
 * The Human Coaches' path (ADR-0105): the landing page's design for the other audience. What Jobbbox is for a coach, a
 * marketplace and a workspace; the path from the request to the payout as a story read by scrolling; the terms with a
 * Candidate; who sells and who collects; the questions; and one action, « Devenir coach sur Jobbbox », which leads to
 * the Coach Enrolment form. No Commission rate, no price and no amount: none is set where this page could read it, and
 * what is not set is not shown.
 */
export async function LandingCoach() {
  const t = await getServerT();
  const locale = await getUrlLocale();
  const screens = { request: <RequestScreen />, profile: <ProfileScreen />, sessions: <SessionScreen />, earnings: <EarningsScreen /> };
  const action = (
    <Link className={`${buttonClass({ variant: "primary" })} landing-action`} href={localePath(COACH_ENROLMENT_PATH, locale)}>
      {t("landing.coachPath.cta")}
    </Link>
  );
  return (
    <main id="main" className="landing">
      <section className="landing-hero">
        <LandingAudience current="coach" />
        <h1 className="landing-display">{t("landing.coachPath.hero.title")}</h1>
        <p className="landing-lead">{t("landing.coachPath.hero.lead")}</p>
        <div className="landing-hero__action">
          {action}
          <span className="landing-meta">{t("landing.coachPath.note")}</span>
        </div>
        <div className="landing-stage landing-hero__stage">
          <ProfileScreen />
        </div>
      </section>

      <section className="landing-section" id="parcours" aria-labelledby="landing-coach-method">
        <div className="landing-head">
          <p className="landing-eyebrow">{t("landing.coachPath.method.eyebrow")}</p>
          <h2 className="landing-h2" id="landing-coach-method">
            {t("landing.coachPath.method.title")}
          </h2>
          <p className="landing-lead">{t("landing.coachPath.method.lead")}</p>
        </div>
        <LandingStory
          steps={STEPS.map((step, index) => ({
            id: step,
            label: t(`landing.method.steps.${STEP_LABELS[index]!}.label`),
            title: t(`landing.coachPath.method.steps.${step}.title`),
            text: t(`landing.coachPath.method.steps.${step}.text`),
            screen: screens[step],
          }))}
        />
      </section>

      <section className="landing-section landing-quote" aria-labelledby="landing-coach-terms">
        <p className="landing-eyebrow" id="landing-coach-terms">
          {t("landing.coachPath.terms.eyebrow")}
        </p>
        <p className="landing-quote__words">{t("landing.coachPath.terms.quote")}</p>
        <p className="landing-body">{t("landing.coachPath.terms.text")}</p>
      </section>

      <section className="landing-section landing-pair">
        <div>
          <p className="landing-eyebrow">{t("landing.coachPath.seller.eyebrow")}</p>
          <h2 className="landing-h3">{t("landing.coachPath.seller.title")}</h2>
          <p className="landing-body">{t("landing.coachPath.seller.text")}</p>
        </div>
        <div>
          <p className="landing-eyebrow">{t("landing.coachPath.associations.eyebrow")}</p>
          <h2 className="landing-h3">{t("landing.coachPath.associations.title")}</h2>
          <p className="landing-body">{t("landing.coachPath.associations.text")}</p>
        </div>
      </section>

      <section className="landing-section landing-narrow" aria-labelledby="landing-coach-questions">
        <div className="landing-head" data-align="start">
          <p className="landing-eyebrow">{t("landing.coachPath.questions.eyebrow")}</p>
          <h2 className="landing-h2" id="landing-coach-questions">
            {t("landing.coachPath.questions.title")}
          </h2>
        </div>
        <div className="landing-questions">
          {QUESTIONS.map((question) => (
            <details key={question}>
              <summary>{t(`landing.coachPath.questions.${question}.question`)}</summary>
              <p className="landing-body">{t(`landing.coachPath.questions.${question}.answer`)}</p>
            </details>
          ))}
        </div>
      </section>

      <LandingDoors current="coach" />

      <section className="landing-end" aria-labelledby="landing-coach-end">
        <span className="landing-end__logo">
          <Logo />
        </span>
        <h2 className="landing-h2" id="landing-coach-end">
          {t("landing.coachPath.end.title")}
        </h2>
        <p className="landing-lead">{t("landing.coachPath.end.lead")}</p>
        {action}
      </section>
    </main>
  );
}
