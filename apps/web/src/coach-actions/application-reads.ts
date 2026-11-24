/**
 * What the AI Coach reads of an Application beside its Job Offer (ADR-0114), told in our own words around the text the
 * Candidate did not write, which each telling says it holds (`untrusted`):
 *  - its Company Dossier in full, with its source (the French register's official data, or web pages, less reliable),
 *    for the AI Coach to quote with that source; or what is missing and what to propose instead;
 *  - its Enriched Contacts: each one's id, name, role and whether it is revealed. Their email and phone never reach the AI
 *    model: they are not even given to this telling;
 *  - its Coach Reviews: each one's author as « Prénom N. », date, Tailored Document and text. Private Coach Notes are not
 *    Coach Reviews: nothing here reads them.
 */
import { createI18n } from "@jobhub/shared/i18n";
import { namesFromFullName } from "../candidate-identity/names";
import { day } from "../coach/context";
import type { CompanyDossier, CompanyDossierState } from "../company-dossiers";
import type { EnrichedContactsState } from "../enriched-contacts";
import type { CoachReview, ReviewedDocument } from "../human-coaches";

/** A telling of one of them: its text, and whether it holds text the Candidate did not write. */
export interface ApplicationReadText {
  text: string;
  untrusted: boolean;
}

const { t } = createI18n("fr");

const euros = (amount: number) => `${amount} €`;

function dossierFacts(dossier: CompanyDossier): string[] {
  if (dossier.source === "french_register") {
    const headcount = dossier.headcount ? (dossier.headcount.max ? `${dossier.headcount.min} à ${dossier.headcount.max} salariés` : `${dossier.headcount.min} salariés ou plus`) : "";
    return [
      "Source : registre français des entreprises (données officielles).",
      `Raison sociale : ${dossier.name} (SIREN ${dossier.siren})${dossier.legalForm ? `, ${dossier.legalForm}` : ""}.`,
      dossier.activity ? `Activité : ${dossier.activity}.` : "",
      dossier.address ? `Adresse : ${dossier.address}.` : "",
      headcount ? `Effectif : ${headcount}.` : "",
      dossier.financials.length
        ? [
            "Chiffres publiés :",
            ...dossier.financials.map(
              ({ year, revenue, netIncome }) =>
                `- ${year} : ${[revenue === undefined ? "" : `chiffre d'affaires ${euros(revenue)}`, netIncome === undefined ? "" : `résultat net ${euros(netIncome)}`].filter(Boolean).join(", ") || "aucun chiffre"}`,
            ),
          ].join("\n")
        : "L'entreprise ne publie pas de chiffres financiers.",
      dossier.executiveRoles.length ? `Fonctions des dirigeants : ${dossier.executiveRoles.join(", ")}.` : "",
    ];
  }
  return [
    "Source : pages web, moins fiables : à vérifier, et à dire au candidat quand tu t'en sers.",
    dossier.country ? `Pays : ${dossier.country}.` : "",
    dossier.address ? `Adresse : ${dossier.address}.` : "",
    dossier.industry ? `Secteur : ${dossier.industry}.` : "",
    dossier.headcount ? `Effectif : ${dossier.headcount}.` : "",
    dossier.revenue ? `Chiffre d'affaires : ${dossier.revenue}.` : "",
    dossier.website ? `Site : ${dossier.website}.` : "",
    dossier.sources.length ? `Pages lues : ${dossier.sources.join(", ")}.` : "",
  ];
}

/** An Application's Company Dossier in full, or what is missing and what to propose. */
export function companyDossierText(applicationId: string, state: CompanyDossierState): ApplicationReadText {
  switch (state.status) {
    case "not_built":
      return {
        text: `Le dossier entreprise de la candidature (id ${applicationId}) n'est pas encore constitué : propose de le constituer avec propose_company_dossier_rebuild si le candidat en a besoin.`,
        untrusted: false,
      };
    case "employer_unknown":
      return {
        text: `L'offre de la candidature (id ${applicationId}) ne nomme pas l'employeur : aucun dossier entreprise. Propose au candidat de nommer l'employeur avec propose_dossier_employer.`,
        untrusted: false,
      };
    case "awaiting_confirmation":
      return {
        text: [
          `L'offre de la candidature (id ${applicationId}) vient d'un cabinet de recrutement${state.agency ? ` (${state.agency})` : ""} : aucun dossier entreprise tant que le candidat n'a pas confirmé l'employeur.`,
          state.presumedEmployer ? `Employeur présumé : ${state.presumedEmployer}.` : "Employeur présumé : non nommé.",
          state.presumedEmployerDescription ? `Description de l'employeur dans l'offre : ${state.presumedEmployerDescription}` : "",
          "Propose au candidat de confirmer ou de corriger l'employeur avec propose_dossier_employer.",
        ]
          .filter(Boolean)
          .join("\n"),
        untrusted: true,
      };
    case "built": {
      const { dossier } = state;
      return {
        text: [
          `Dossier entreprise de la candidature (id ${applicationId}), constitué le ${day(dossier.builtAt)} pour « ${dossier.employer} ». Cite-le en donnant sa source (« d'après le dossier entreprise, source : … »).`,
          ...dossierFacts(dossier),
          dossier.suggestedContactRoles.length ? `Fonctions à contacter : ${dossier.suggestedContactRoles.map((role) => t(`companyDossier.contactRoles.${role}`)).join(" ; ")}.` : "",
          dossier.news.length
            ? ["Actualités de l'employeur (titres seulement) :", ...dossier.news.map((article) => `- ${article.publishedAt}, ${article.outlet} : « ${article.title} » (${article.url})`)].join("\n")
            : dossier.newsSearched
              ? "Aucune actualité trouvée."
              : "Actualités non recherchées : propose_company_dossier_rebuild les recherche.",
        ]
          .filter(Boolean)
          .join("\n"),
        untrusted: true,
      };
    }
  }
}

/** An Application's Enriched Contacts and people found: id, name, role, revealed or not. Never their details. */
export function enrichedContactsText(applicationId: string, state: Pick<EnrichedContactsState, "enabled" | "searchable"> & { found: readonly Person[]; contacts: readonly Person[] }): ApplicationReadText {
  if (!state.enabled) return { text: "Les contacts enrichis ne sont pas disponibles sur Jobbbox en ce moment : ne propose ni recherche ni révélation de contact.", untrusted: false };
  const line = (person: Person, status: string) => `- contact (id ${person.id}) ${person.name}${person.jobTitle ? `, ${person.jobTitle}` : ""} : ${status}`;
  const people = [...state.contacts.map((person) => line(person, "révélé")), ...state.found.map((person) => line(person, "trouvé, pas encore révélé"))];
  if (people.length === 0)
    return {
      text: `Aucun contact enrichi pour la candidature (id ${applicationId}).${state.searchable ? " Propose une recherche de contacts avec propose_contact_search si le candidat le demande." : ""}`,
      untrusted: false,
    };
  return {
    text: [
      `Contacts enrichis de la candidature (id ${applicationId}) : nom et fonction, jamais leurs coordonnées, que le candidat lit sur sa page. Un contact révélé peut recevoir un message d'approche (propose_outreach_message avec son contactId) ; un contact trouvé se révèle avec propose_contact_reveal.`,
      ...people,
    ].join("\n"),
    untrusted: true,
  };
}

/** What the telling of a person found or revealed takes of them: never their email nor their phone. */
interface Person {
  id: string;
  name: string;
  jobTitle?: string;
}

const REVIEWED: Record<ReviewedDocument, string> = { tailored_cv: "le CV adapté", cover_letter: "la lettre de motivation", outreach_message: "le message d'approche" };

/** A Human Coach as a Coach Review names them to the AI Coach: « Marie L. », their first name and last initial. */
export function reviewAuthor(name: string): string {
  const { givenName, familyName } = namesFromFullName(name);
  const initial = Array.from(familyName)[0]?.toLocaleUpperCase("fr");
  return [givenName, initial ? `${initial}.` : ""].filter(Boolean).join(" ") || "un coach";
}

/** An Application's Coach Reviews, oldest first: author, date, Tailored Document and text. */
export function coachReviewsText(applicationId: string, reviews: readonly Pick<CoachReview, "coach" | "document" | "text" | "createdAt">[]): ApplicationReadText {
  if (reviews.length === 0) return { text: `Aucun avis de coach humain sur la candidature (id ${applicationId}).`, untrusted: false };
  return {
    text: [
      `Avis des coachs humains sur la candidature (id ${applicationId}), du plus ancien au plus récent. Sers-t'en dans tes propositions ; ne propose jamais de modifier ni de supprimer un avis.`,
      ...reviews.map((review) => `- avis de ${reviewAuthor(review.coach.name)}, le ${day(review.createdAt)}, sur ${REVIEWED[review.document]} : ${review.text}`),
    ].join("\n"),
    untrusted: true,
  };
}
