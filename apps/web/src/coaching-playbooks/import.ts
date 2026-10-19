/**
 * The one-off import (#225): today's coaching knowledge files (`@jobhub/coach-knowledge`) as version 1
 * of each Coaching Playbook, of the Core Digest and of the Sources list, none of them Human-validated.
 * Each Coaching Playbook gets a default Playbook Agent: the AI Coach's route (provider and model) in
 * this environment, effort medium, and when to consult it as the Playbook table said (#129).
 */
import { taskRouteFromEnv } from "@jobhub/ai";
import { readCoachKnowledgeFiles } from "@jobhub/coach-knowledge";
import type { PlaybookSeed } from "./index";

type Env = Record<string, string | undefined>;

/** When to consult each imported playbook: what is In view and the topics of the former Playbook table, in words. */
const CONSULT_WHEN: Record<string, string> = {
  "cover-letter-writing":
    "Quand le candidat consulte une candidature, ou parle de sa lettre de motivation : rédaction, structure, ton et adaptation de la lettre à l'offre.",
  "ats-optimization":
    "Quand le candidat consulte une candidature, ou parle du passage de son CV dans les logiciels de recrutement (ATS), des mots-clés d'une offre ou de l'adaptation de son CV à une candidature.",
  "cv-offer-fit-scoring":
    "Quand le candidat consulte une offre d'emploi, une recherche ou un Job Digest, ou demande si une offre lui correspond : annonce, fiche de poste, score de correspondance, adéquation.",
  "interview-journey-stages":
    "Quand le candidat prépare un entretien : étapes du processus de recrutement, entretien avec le N+1 ou le N+2, recruteur ou manager, prétentions salariales.",
  "interview-psychology":
    "Quand le candidat prépare un entretien et s'interroge sur sa posture, son stress, les questions difficiles, l'image qu'il donne ou la négociation de son salaire.",
  "outreach-first-contact":
    "Quand le candidat veut contacter quelqu'un : réseau, LinkedIn, premier message, cooptation, approche directe d'un recruteur, d'un cabinet ou d'un chasseur de têtes.",
  "application-strategy":
    "Quand le candidat réfléchit à sa stratégie de candidature : réseau, marché caché, candidatures spontanées, cabinets de recrutement, où et comment postuler.",
  "freelance-mission-positioning":
    "Quand le candidat envisage le freelance, le portage salarial, l'intérim, le management de transition, le statut d'indépendant ou d'auto-entrepreneur, ou parle de son TJM.",
  "senior-40plus-positioning":
    "Quand le candidat consulte son profil, ou parle de son positionnement, de son âge, de son CV, de son pitch, d'une reconversion, d'une surqualification ou de discrimination liée à l'âge. Utile à tout candidat quand aucun autre sujet ne ressort.",
  "coaching-journey-gamification":
    "Quand le candidat parle du rythme de sa recherche, de sa motivation, de découragement ou de fatigue, de son budget, du chômage ou de la durée de sa recherche, ou demande un plan d'action.",
};

/** What the import writes, from the files of `@jobhub/coach-knowledge` and the AI Coach's route in `env`. */
export function importedPlaybooks(env: Env = process.env): PlaybookSeed {
  const files = readCoachKnowledgeFiles();
  const route = taskRouteFromEnv(env, "coaching");
  return {
    sources: files.sources.text,
    coreDigest: files.coreDigest.text,
    playbooks: files.playbooks.map((playbook) => ({
      id: playbook.id,
      content: playbook.text,
      agent: { provider: route.provider, model: route.model ?? null, effort: "medium", consultWhen: CONSULT_WHEN[playbook.id] ?? playbook.title },
    })),
  };
}
