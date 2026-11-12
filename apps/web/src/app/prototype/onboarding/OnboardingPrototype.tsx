"use client";

import { Building2, Landmark, Target } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { Icons, ICON_STROKE } from "@/components/icons";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Pill } from "@/design/Pill";
import { Ring } from "@/design/Ring";
import "@/components/QuickActions.css";
import "@/components/JobOfferResults.css";
import "./prototype.css";

import type { State } from "./states";

/* THROWAWAY prototype (#995): static fake data, no API, no sign-in. */

type Field = { label: string; value: string | null; reading?: boolean };

const FIELDS: Field[] = [
  { label: "Poste visé", value: "Directeur financier" },
  { label: "Expérience", value: "18 ans" },
  { label: "Basé à", value: "Lyon (69)" },
  { label: "Types de contrat", value: "CDI" },
  { label: "Salaire souhaité", value: null },
  { label: "Compétences", value: "Contrôle de gestion, consolidation…", reading: true },
];

const SOURCES = [
  { name: "France Travail", icon: <Landmark className="icon" strokeWidth={ICON_STROKE} aria-hidden /> },
  { name: "Sites carrières des employeurs", icon: <Building2 className="icon" strokeWidth={ICON_STROKE} aria-hidden /> },
  { name: "Recherche web", icon: <Icons.searchSites /> },
  { name: "API d'ATS", icon: <Icons.extensionEvents /> },
  { name: "Entreprises cibles", icon: <Target className="icon" strokeWidth={ICON_STROKE} aria-hidden /> },
];

const OFFERS = [
  { title: "Directeur administratif et financier", employer: "Verdier Industries (exemple)", place: "Lyon 7e · Télétravail partiel", contract: "CDI", score: 92 },
  { title: "Directeur financier groupe", employer: "Rhône Logistique Services (exemple)", place: "Villeurbanne", contract: "CDI", score: 87 },
  { title: "Responsable consolidation et contrôle de gestion", employer: "Atelier Céleste (exemple)", place: "Lyon 3e · Télétravail partiel", contract: "CDI", score: 81 },
];

const SUMMARY_TEXT =
  "Vous recherchez un poste de Directeur financier en CDI à Lyon ou en télétravail partiel, à partir de 75 000 € brut par an. Avec 18 ans d'expérience, dont 8 à la tête d'une direction financière, vous mettez en avant vos compétences en contrôle de gestion, consolidation, pilotage de trésorerie et management d'équipe. Vous visez des entreprises industrielles ou de services de 200 à 2 000 salariés.";

export function OnboardingPrototype({ state }: { state: State }) {
  const { t } = useTranslation();
  const searching = state === "recherche" || state === "offres";
  return (
    <div className="proto-shell">
      <header className="proto-topbar">
        <span className="brand">Jobbbox</span>
        <h1 className="proto-title">{t("newProfile.title")}</h1>
        <span className="proto-flag">Prototype #995 · données fictives</span>
      </header>
      <main className="proto-page">
        <section className="page-conversation" aria-label={t("newProfile.conversation")} data-wide={searching || undefined}>
          <div className="page-conversation-thread">
            <ol className="chat coach-panel-messages" aria-label={t("coachPanel.messagesLabel")} aria-live="polite">
              <li className="chat-message chat-coach welcome-panel">
                <span className="visually-hidden">{t("questionnaire.coach")}</span>
                <button className="welcome-panel-close" type="button">
                  <Icons.close />
                  {t("conversationFirst.closeWelcome")}
                </button>
                <p>{t("coachPanel.aiDisclosure")}</p>
                <p>{t("newProfile.intro")}</p>
              </li>
              <li className="chat-message chat-candidate">
                <span className="visually-hidden">{t("questionnaire.you")}</span>
                <p>J&apos;ai importé mon CV : CV-2026.pdf</p>
              </li>
              {state === "construction" ? <Construction /> : null}
              {state === "resume" || state === "modification" ? (
                <>
                  <BuiltLine />
                  <Summary editing={state === "modification"} />
                </>
              ) : null}
              {searching ? (
                <>
                  <BuiltLine />
                  <li className="chat-message chat-candidate">
                    <span className="visually-hidden">{t("questionnaire.you")}</span>
                    <p>Cela semble correct</p>
                  </li>
                  <Search done={state === "offres"} />
                </>
              ) : null}
            </ol>
          </div>
          <Foot state={state} />
        </section>
      </main>
    </div>
  );
}

function CoachLine({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {children}
    </li>
  );
}

/** A step of the stepper: done (✓), under way (the live glyph), or to come (an empty circle). */
function Step({ status, title, children }: { status: "done" | "current" | "pending"; title: string; children?: ReactNode }) {
  return (
    <li className="onb-step" data-status={status} aria-current={status === "current" ? "step" : undefined}>
      <span className="onb-step-marker" aria-hidden>
        {status === "done" ? <Icons.done /> : status === "current" ? <span className="onb-step-pulse" /> : null}
      </span>
      <div className="onb-step-body">
        <p className="onb-step-title">
          {title}
          <span className="visually-hidden">{status === "done" ? " (terminé)" : status === "current" ? " (en cours)" : " (à venir)"}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

function FieldRows({ all }: { all: boolean }) {
  return (
    <dl className="onb-fields">
      {FIELDS.map((field) => (
        <div key={field.label} className="onb-field" data-reading={!all && field.reading ? "" : undefined}>
          <dt>{field.label}</dt>
          <dd>
            {field.value === null ? (
              <em className="onb-field-missing">Pas encore dans votre profil</em>
            ) : !all && field.reading ? (
              <span className="onb-field-reading">Lecture en cours…</span>
            ) : (
              field.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** État 1 : « Profil en construction ». */
function Construction() {
  return (
    <>
      <CoachLine>
        <p>Merci. Je lis votre CV et je prépare votre profil : cela prend moins d&apos;une minute.</p>
      </CoachLine>
      <li className="chat-message chat-card">
        <Card title="Profil en construction" headingLevel={3} actions={<Pill tone="accent">Étape 1 sur 4</Pill>}>
          <div className="onb-building">
            <ActivityGlyph activity="read" live />
            <ol className="onb-stepper">
              <Step status="current" title="Lecture de votre profil">
                <FieldRows all={false} />
              </Step>
              <Step status="pending" title="Préparation de vos critères de recherche" />
              <Step status="pending" title="Résumé de ce que vous recherchez" />
              <Step status="pending" title="Recherche de vos premières offres" />
            </ol>
          </div>
        </Card>
      </li>
    </>
  );
}

/** The construction card once done, folded to a line. */
function BuiltLine() {
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">Coach</span>
      <details className="coach-tools-consulted">
        <summary>
          <ActivityGlyph activity="read" />
          Profil construit à partir de votre CV · 6 informations lues
        </summary>
        <FieldRows all />
      </details>
    </li>
  );
}

/** État 2 : le résumé « Ai-je bien compris ? », et sa modification. */
function Summary({ editing }: { editing: boolean }) {
  return (
    <>
      <CoachLine>
        <p className="onb-badge-line">
          <Pill tone="accent">
            <Icons.nouveautes />
            Presque fini
          </Pill>
        </p>
        <p>Voici comment je comprends ce que vous recherchez. Ai-je bien compris ?</p>
      </CoachLine>
      <li className="chat-message chat-card">
        <Card title="Votre recherche d'offres" headingLevel={3} actions={editing ? <Pill tone="warn">Modification</Pill> : null}>
          {editing ? (
            <div className="ds-field onb-edit">
              <label className="visually-hidden" htmlFor="onb-summary">
                Votre recherche d&apos;offres
              </label>
              <p id="onb-summary-hint" className="ds-field__hint">
                Écrivez-le comme vous l&apos;expliqueriez à un recruteur.
              </p>
              <textarea id="onb-summary" className="ds-input ds-textarea onb-textarea" rows={7} aria-describedby="onb-summary-hint" defaultValue={SUMMARY_TEXT} />
              <div className="onb-actions">
                <button type="button" className={buttonClass({ variant: "secondary" })}>
                  Annuler
                </button>
                <button type="button" className={buttonClass({ variant: "primary" })}>
                  Terminé
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="onb-summary">
                Vous recherchez un poste de <strong>Directeur financier</strong> en <strong>CDI</strong> à <strong>Lyon</strong> ou{" "}
                <strong>en télétravail partiel</strong>, à partir de <strong>75 000 €</strong> brut par an. Avec <strong>18 ans d&apos;expérience</strong>,
                dont 8 à la tête d&apos;une direction financière, vous mettez en avant vos compétences <strong>contrôle de gestion</strong>,{" "}
                <strong>consolidation</strong>, <strong>pilotage de trésorerie</strong> et <strong>management d&apos;équipe</strong>. Vous visez des
                entreprises industrielles ou de services de <strong>200 à 2 000 salariés</strong>.
              </p>
              <div className="onb-actions">
                <a className="onb-detail-link" href="#detail">
                  Voir le détail
                </a>
                <span className="onb-actions-buttons">
                  <button type="button" className={buttonClass({ variant: "secondary" })}>
                    Modifier
                  </button>
                  <button type="button" className={buttonClass({ variant: "primary" })}>
                    <Icons.done />
                    Cela semble correct
                  </button>
                </span>
              </div>
            </>
          )}
        </Card>
      </li>
    </>
  );
}

/** État 3 : la recherche des premières offres, puis ses résultats. */
function Search({ done }: { done: boolean }) {
  const counters = done
    ? [
        ["5 / 5", "sources consultées"],
        ["342", "pages lues"],
        ["118", "offres analysées"],
        ["14", "offres qui vous correspondent"],
      ]
    : [
        ["3 / 5", "sources consultées"],
        ["127", "pages lues"],
        ["46", "offres analysées"],
        ["6", "offres qui vous correspondent"],
      ];
  return (
    <>
      <CoachLine>
        <p>{done ? "J'ai trouvé vos premières offres. Voici les trois qui vous correspondent le mieux." : "Parfait. Je cherche maintenant vos premières offres : vous pouvez rester sur cette page ou y revenir plus tard."}</p>
      </CoachLine>
      <li className="chat-message chat-card">
        <Card title={done ? "Vos premières offres sont prêtes" : "Recherche de vos premières offres"} headingLevel={3} actions={done ? <Pill tone="success">Terminé</Pill> : <Pill tone="accent">En cours</Pill>}>
          <div className="onb-search">
            <div className="onb-search-visual">
              <div className="onb-orbit" data-done={done || undefined} aria-hidden>
                <span className="onb-orbit-ring onb-orbit-ring-1" />
                <span className="onb-orbit-ring onb-orbit-ring-2" />
                <span className="onb-orbit-center">{done ? <Icons.done /> : <ActivityGlyph activity="search" live />}</span>
                <span className="onb-orbit-track">
                  {SOURCES.map((source, index) => (
                    <span key={source.name} className="onb-orbit-item" style={{ "--i": index } as CSSProperties} data-on={done || index < 3 || undefined}>
                      <span className="onb-orbit-item-icon">{source.icon}</span>
                    </span>
                  ))}
                </span>
              </div>
              <dl className="onb-counters">
                {counters.map(([value, label]) => (
                  <div key={label} className="onb-counter">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="onb-sources" aria-label="Sources">
                {SOURCES.map((source, index) => (
                  <li key={source.name} data-state={done || index < 2 ? "done" : index === 2 ? "current" : "pending"}>
                    {source.icon}
                    {source.name}
                    <span className="onb-source-state">{done || index < 2 ? "consultée" : index === 2 ? "en cours…" : "à venir"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ol className="onb-stepper onb-search-steps">
              <Step status="done" title="Lecture de votre profil">
                <p className="onb-step-meta">Directeur financier · CDI · Lyon ou télétravail partiel · 75 000 € · 18 ans d&apos;expérience</p>
              </Step>
              <Step status={done ? "done" : "current"} title="Recherche sur France Travail, les sites carrières et le web">
                <p className="onb-step-meta">{done ? "5 sources consultées, 342 pages lues" : "Sites carrières des employeurs lyonnais…"}</p>
              </Step>
              <Step status={done ? "done" : "pending"} title="Analyse des offres trouvées">
                {done ? <p className="onb-step-meta">118 offres analysées, doublons et offres expirées écartés</p> : null}
              </Step>
              <Step status={done ? "done" : "pending"} title="Sélection de vos meilleures offres">
                {done ? <p className="onb-step-meta">14 offres avec un score de correspondance d&apos;au moins 70</p> : null}
              </Step>
            </ol>
          </div>
        </Card>
      </li>
      {done ? (
        <li className="chat-message chat-card">
          <ol className="job-offer-results onb-offers">
            {OFFERS.map((offer) => (
              <li key={offer.title} className="job-offer-result">
                <div className="job-offer-result__main">
                  <h4 className="job-offer-result__title">
                    <a href="#offre">{offer.title}</a>
                  </h4>
                  <p className="job-offer-result__meta">
                    <span>{offer.employer}</span>
                    <span>{offer.place}</span>
                  </p>
                </div>
                <div className="job-offer-result__score">
                  <p className="visually-hidden">Score de correspondance : {offer.score} sur 100</p>
                  <Ring decorative value={offer.score} />
                  <span className="job-offer-result__caption" aria-hidden>
                    Correspondance
                  </span>
                </div>
                <p className="job-offer-result__pills">
                  <Pill>{offer.contract}</Pill>
                </p>
              </li>
            ))}
          </ol>
          <div className="onb-actions onb-offers-actions">
            <a className={buttonClass({ variant: "secondary" })} href="#offres">
              Voir toutes les offres (14)
            </a>
            <a className={buttonClass({ variant: "primary" })} href="#profil">
              Continuer vers mon profil
            </a>
          </div>
        </li>
      ) : null}
    </>
  );
}

/** The box at the foot, as on every conversation: suggestions, then the composer with « Coach IA » and « Envoyer au coach ». */
function Foot({ state }: { state: State }) {
  const { t } = useTranslation();
  const suggestions: Record<State, string[]> = {
    construction: ["Arrêter et répondre aux questions"],
    resume: ["Ajouter un critère", "Changer le salaire"],
    modification: [],
    recherche: ["Ajouter une entreprise cible"],
    offres: ["Pourquoi ces offres ?", "Élargir à Grenoble"],
  };
  return (
    <div className="page-conversation-foot">
      {suggestions[state].length > 0 ? (
        <div className="page-conversation-suggestions" role="group" aria-label={t("conversationFirst.suggestions")}>
          <div className="quick-actions">
            {suggestions[state].map((label) => (
              <button key={label} className={buttonClass({ variant: "secondary", size: "sm" })} type="button">
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form className="coach-panel-form coach-panel-form-inline" onSubmit={(event) => event.preventDefault()}>
        <label className="visually-hidden" htmlFor="proto-message">
          {t("coachPanel.messageLabel")}
        </label>
        <div className="coach-panel-composer coach-panel-composer-inline">
          <textarea id="proto-message" rows={1} placeholder={t("coachPanel.messageLabel")} />
          <div className="coach-panel-composer-actions">
            <button className="pill coach-panel-badge" data-tone="accent" type="button" aria-label={t("conversationFirst.welcomeOpen")}>
              <span className="composer-label">{t("coachPanel.badge")}</span>
              <span className="composer-short" aria-hidden="true">
                {t("coachPanel.badgeShort")}
              </span>
            </button>
            <button className={`${buttonClass({ variant: "primary" })} composer-send`} type="submit">
              <Icons.enter />
              <span className="composer-label">{t("coachPanel.send")}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
