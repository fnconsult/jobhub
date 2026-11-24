/**
 * What the AI Coach is told when CV edits make no proposal (#719, ADR-0113), for the Master CV and the Tailored CV
 * alike: the true reason in our own words, and, for a fact the CV does not say and the Candidate never declared, the
 * Typed redirect to the Master CV's section where they add it themselves (ADR-0114).
 *
 *   if (!review.ok) return cvEditRefusal(review, "le CV de référence");
 */
import type { MasterCvReviewRefusal } from "../profiles/master-cv-proposal";
import type { CoachActionResult } from "./index";

/** The refusal of `review`, `cv` naming the CV edited (« le CV de référence », « le CV adapté »). */
export function cvEditRefusal(review: MasterCvReviewRefusal, cv: string): Extract<CoachActionResult, { ok: false; error: "refused" }> {
  const refused = (reason: string, redirect?: { section?: (MasterCvReviewRefusal & { error: "not_declared" })["section"] }) => ({
    ok: false as const,
    error: "refused" as const,
    reason,
    ...(redirect ? { redirect: { target: "master_cv_section" as const, ...(redirect.section ? { section: redirect.section } : {}) } } : {}),
  });
  switch (review.error) {
    case "unknown_item":
      return refused(`« ${review.item} » n'est pas dans ${cv} : propose seulement de reformuler, couper, réordonner ou mettre en avant ce qu'il dit déjà, nommé comme il l'écrit.`);
    case "added_item":
      return refused(
        `« ${review.text} » n'est pas une reformulation d'une compétence de ${cv}, et le candidat ne l'a pas déclarée dans cette conversation : une compétence qu'il n'a ni dans son CV ni dite ne s'ajoute pas. Demande-lui s'il l'a ; s'il te la confirme, propose-la de nouveau.`,
        { section: "skills" },
      );
    case "not_declared":
      return refused(
        `« ${review.text} » n'est pas dans ${cv}, et le candidat ne l'a pas dit lui-même dans cette conversation (not_declared) : un fait vient de lui, jamais de l'offre ni de toi. Demande-lui de te le confirmer ; il peut aussi l'ajouter lui-même dans la rubrique de son CV de référence.`,
        { section: review.section },
      );
    case "invented_figure":
      return refused(`« ${review.text} » avance un chiffre que ${cv} ne donne pas : ne propose jamais un fait qu'il ne contient pas ; demande-le au candidat.`);
    case "translated":
      return refused(
        `« ${review.text} » n'est pas dans la langue de ${cv} : il ne se traduit pas par des modifications, qui en laisseraient une partie dans sa langue. Un CV, une lettre ou un message dans une autre langue se prépare pour une candidature, dans sa « Langue des documents » : propose de le préparer avec l'outil prévu et son argument language.`,
      );
    case "invalid_edit":
      return refused(
        `La modification n° ${review.edit + 1} ne se lit pas : une formation se coupe, se réordonne, se met en avant ou s'ajoute (add) ; une langue aussi, et son niveau se corrige (rephrase avec level) ; un poste se reformule par son intitulé ou sa description ; une compétence s'ajoute une par une.`,
      );
    case "no_change":
      return refused(`Ces modifications ne changent rien à ${cv} : rien n'a été proposé.`);
  }
}
