import type { CSSProperties, ReactNode } from "react";
import { Logo } from "@/design/Logo";
import { Pill, Status } from "@/design/Pill";
import "@/design/Ring.css";
import { getServerT } from "@/i18n/server";

/**
 * The landing page's pictures of the product (ADR-0105): its screens redrawn with the Design System's own components
 * and example content, each one marked « Exemple ». A picture, not an interface: read out as one image by its
 * description, its inside hidden from assistive technology, and nothing in it takes the focus.
 */

/** The example offer's Match Score, as its ring is filled; the number shown is the catalogue's (`landing.screens.scoreValue`). */
const SCORE = 82;

type NavItem = "conversation" | "searches" | "applications" | "agenda" | "humanCoaches";
const NAV: readonly NavItem[] = ["conversation", "searches", "applications", "agenda", "humanCoaches"];

/** The app's frame: its Sidebar, the page's title, then the page. `aside`: the Fiche beside it. */
async function AppFrame({ title, current, alt, aside, children }: { title: string; current: NavItem; alt: string; aside?: ReactNode; children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className="landing-app" data-aside={aside ? "" : undefined} role="img" aria-label={alt}>
      <div className="landing-app__side" aria-hidden="true">
        <span className="landing-app__brand">
          <Logo />
          {t("app.name")}
        </span>
        {NAV.map((item) => (
          <span key={item} className="landing-app__nav" data-current={item === current ? "" : undefined}>
            {t(`landing.screens.nav.${item}`)}
          </span>
        ))}
      </div>
      <div className="landing-app__main" aria-hidden="true">
        <div className="landing-app__bar">
          <strong>{title}</strong>
          <span className="landing-meta">{t("landing.example")}</span>
        </div>
        <div className="landing-app__body">{children}</div>
      </div>
      {aside ? (
        <div className="landing-app__aside" aria-hidden="true">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** Why the example offer scores what it does: two reasons that match, one that does not. */
async function Reasons() {
  const t = await getServerT();
  return (
    <ul className="landing-reasons">
      <li data-match="">{t("landing.screens.offers.team")}</li>
      <li data-match="">{t("landing.screens.offers.flows")}</li>
      <li>{t("landing.screens.offers.english")}</li>
    </ul>
  );
}

/** The Match Score ring beside its name. */
async function Score() {
  const t = await getServerT();
  return (
    <div className="landing-score">
      <span className="ds-ring" style={{ "--ds-ring-value": SCORE } as CSSProperties}>
        {t("landing.screens.scoreValue")}
      </span>
      <div>
        <strong>{t("landing.screens.matchScore")}</strong>
        <br />
        <span className="landing-meta">{t("landing.screens.conversation.outOf")}</span>
      </div>
    </div>
  );
}

/** A Coach Conversation: the AI disclosure, the Candidate's question, the coach's reply and what it consulted. `fiche`: the offer's Fiche beside it. */
export async function ConversationScreen({ fiche = false }: { fiche?: boolean }) {
  const t = await getServerT();
  const aside = fiche ? (
    <>
      <div>
        <span className="landing-meta">{t("landing.screens.conversation.fiche")}</span>
        <strong className="landing-app__aside-title">{t("landing.screens.offers.logistics")}</strong>
        <span className="landing-meta">{t("landing.screens.offers.logisticsPlace")}</span>
      </div>
      <Score />
      <Reasons />
      <div>
        <Pill tone="success">{t("landing.screens.application.cvReady")}</Pill>
      </div>
    </>
  ) : undefined;
  return (
    <AppFrame title={t("landing.screens.nav.conversation")} current="conversation" alt={t("landing.screens.conversation.alt")} aside={aside}>
      <p className="landing-chat__disclosure">{t("coachPanel.aiDisclosure")}</p>
      <p className="landing-chat__question">{t("landing.screens.conversation.question")}</p>
      <div className="landing-chat__reply">
        <span className="landing-chat__glyph" />
        <div>
          <p>{t("landing.screens.conversation.reply")}</p>
          <p className="landing-meta">{t("coachPanel.consulted.summary", { count: 2 })}</p>
        </div>
      </div>
      <div className="landing-chat__actions">
        <Pill>{t("landing.screens.conversation.prepareCv")}</Pill>
        <Pill>{t("landing.screens.conversation.prepareLetter")}</Pill>
      </div>
      <div className="landing-chat__box">
        <span>{t("coachPanel.messageLabel")}</span>
        <Pill tone="accent">{t("coachPanel.badge")}</Pill>
      </div>
    </AppFrame>
  );
}

const OFFERS = ["logistics", "warehouse", "supplyChain", "procurement"] as const;

/** Recherches d'offres: four example offers, each with its Match Score; the first one says why. */
export async function OffersScreen() {
  const t = await getServerT();
  return (
    <AppFrame title={t("landing.screens.nav.searches")} current="searches" alt={t("landing.screens.offers.alt")}>
      <div className="landing-rows">
        {OFFERS.map((name, index) => (
          <div key={name} className="landing-row">
            <div>
              <strong>{t(`landing.screens.offers.${name}`)}</strong>
              <br />
              <span className="landing-meta">{t(`landing.screens.offers.${name}Place`)}</span>
            </div>
            <strong className="landing-row__end">{t(`landing.screens.offers.${name}Score`)}</strong>
            {index === 0 ? (
              <div className="landing-row__more">
                <span className="landing-meta">{t("landing.screens.offers.why")}</span>
                <Reasons />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </AppFrame>
  );
}

/** Lines of a document, drawn as bars: `adapted` ones are what the coach tailored to the offer. */
function Lines({ widths, adapted = [] }: { widths: readonly number[]; adapted?: readonly number[] }) {
  return (
    <>
      {widths.map((width, index) => (
        <i key={index} className="landing-line" data-adapted={adapted.includes(index) ? "" : undefined} style={{ width: `${width}%` }} />
      ))}
    </>
  );
}

/** An Application: its tailored CV, ready to review, with what was adapted highlighted. */
export async function ApplicationScreen() {
  const t = await getServerT();
  return (
    <AppFrame title={t("landing.screens.application.title")} current="applications" alt={t("landing.screens.application.alt")}>
      <div className="landing-doc">
        <div className="landing-doc__page">
          <strong className="landing-doc__name">{t("landing.screens.application.cv")}</strong>
          <Lines widths={[42]} />
          <span className="landing-doc__heading">{t("landing.screens.application.profile")}</span>
          <Lines widths={[96, 78]} adapted={[0, 1]} />
          <span className="landing-doc__heading">{t("landing.screens.application.experience")}</span>
          <Lines widths={[92, 88, 70, 84]} adapted={[1]} />
          <span className="landing-doc__heading">{t("landing.screens.application.skills")}</span>
          <Lines widths={[64, 52]} adapted={[0]} />
        </div>
        <div className="landing-doc__side">
          <Pill tone="success">{t("landing.screens.application.ready")}</Pill>
          <Pill tone="accent">{t("landing.screens.application.cv")}</Pill>
          <Pill>{t("landing.screens.application.letter")}</Pill>
          <span className="landing-meta">{t("landing.screens.application.note")}</span>
        </div>
      </div>
    </AppFrame>
  );
}

const FOLLOW_UPS = [
  { offer: "logistics", state: "interview", next: "interviewWhen", tone: "success" },
  { offer: "warehouse", state: "sent", next: "sentNext", tone: "neutral" },
  { offer: "supplyChain", state: "toPrepare", next: "toPrepareNext", tone: "warn" },
] as const;

/** The rows of the follow-up: each Application with where it stands and what comes next. */
async function FollowUpRows() {
  const t = await getServerT();
  return (
    <div className="landing-rows">
      {FOLLOW_UPS.map(({ offer, state, next, tone }) => (
        <div key={offer} className="landing-row">
          <div>
            <strong>{t(`landing.screens.offers.${offer}`)}</strong>
            <br />
            <span className="landing-meta">{t(`landing.screens.offers.${offer}Place`)}</span>
          </div>
          <div className="landing-row__end">
            <Status tone={tone}>{t(`landing.screens.followUp.${state}`)}</Status>
            <br />
            <span className="landing-meta">{t(`landing.screens.followUp.${next}`)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Candidatures: the follow-up in one place. */
export async function FollowUpScreen() {
  const t = await getServerT();
  return (
    <AppFrame title={t("landing.screens.nav.applications")} current="applications" alt={t("landing.screens.followUp.alt")}>
      <FollowUpRows />
    </AppFrame>
  );
}

/** A job offer's page in a browser, the extension's panel beside it with the Match Score and its detail. */
export async function ExtensionScreen() {
  const t = await getServerT();
  return (
    <div className="landing-browser" role="img" aria-label={t("landing.screens.extension.alt")}>
      <div className="landing-browser__bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span />
      </div>
      <div className="landing-browser__body" aria-hidden="true">
        <div className="landing-browser__page">
          <strong className="landing-doc__name">{t("landing.screens.offers.logistics")}</strong>
          <span className="landing-meta">{t("landing.screens.offers.logisticsPlace")}</span>
          <Lines widths={[94, 86, 90, 60]} />
          <span className="landing-browser__button">{t("extension.badge")}</span>
        </div>
        <div className="landing-browser__panel">
          <span className="landing-app__brand">
            <Logo />
            {t("app.name")}
          </span>
          <Score />
          <strong>{t("landing.screens.extension.detail")}</strong>
          <Reasons />
        </div>
      </div>
    </div>
  );
}

/** The app on a telephone: the same follow-up, on the same account. */
export async function AppScreen() {
  const t = await getServerT();
  return (
    <div className="landing-phone" role="img" aria-label={t("landing.screens.app.alt")}>
      <div className="landing-phone__screen" aria-hidden="true">
        <span className="landing-app__brand">
          <Logo />
          {t("app.name")}
        </span>
        <strong className="landing-doc__name">{t("landing.screens.nav.applications")}</strong>
        <FollowUpRows />
      </div>
    </div>
  );
}
