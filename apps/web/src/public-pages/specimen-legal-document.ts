import type { LegalDocument } from "@jobhub/help";

const PARAGRAPH =
  "Ce paragraphe tient la place d'un texte que l'équipe Jobbbox écrira : il n'engage personne et ne décrit aucun traitement réel. Il est assez long pour que la page défile comme un vrai document légal, section après section, jusqu'à son pied.";

/**
 * A long Legal Document that says nothing (#470): the Légal page's layout on the test page, for the e2e suite's
 * scroll check, while the team has written no real text. Never served in production or on the Beta.
 */
export const SPECIMEN_LEGAL_DOCUMENT: LegalDocument = {
  id: "confidentialite",
  locale: "fr",
  version: "0.1",
  effective: "2026-10-29",
  title: "Spécimen de document légal",
  summary: ["Un texte de démonstration, sans valeur juridique.", "Il sert à vérifier la mise en page de la page Légal."],
  sections: Array.from({ length: 12 }, (_, index) => ({
    id: `section-${index + 1}`,
    number: index + 1,
    title: `Section de démonstration ${index + 1}`,
    body: [PARAGRAPH, PARAGRAPH, "- Un premier point de la liste.\n- Un deuxième point de la liste.", PARAGRAPH].join("\n\n"),
  })),
};
