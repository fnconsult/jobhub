/**
 * The import (#225, ADR-0026): today's coaching knowledge files (`@jobhub/coach-knowledge`) as version 1
 * of each Coaching Playbook, of the Core Digest and of the Sources list, none of them Human-validated.
 * Each Coaching Playbook gets a default Playbook Agent: the AI Coach's route (provider and model) in
 * this environment, effort medium, and when to consult it as the Playbook table said (#129).
 *
 * And each task Playbook (`@jobhub/coach-knowledge/tasks`) as its version 1: the instructions its task
 * used until then, run by a Playbook Agent on the task's route in this environment with no effort (the
 * model's own, as before), and with no web-search provider named (its searches on the configured
 * web-search route), so nothing changes when it is served. The tasks that ran before task
 * Playbooks are imported Human-validated by François Nader, who approved it so production kept running
 * them; the Job Offer Summary and sector, new, are not.
 *
 * A task whose text written in the code came after its version 1 (`firstVersion`, #405: company-facts-search,
 * whose Playbook Agent now reads the pages found) is imported as that version 1, then its text as the next
 * version, not validated: production keeps running version 1 until a person validates it. That later version's
 * Playbook Agent is the task's route in this environment on its provider's smallest model: it reads a few pages.
 */
import { smallModelFromEnv, taskRouteFromEnv, type AiTask } from "@jobhub/ai";
import { readCoachKnowledgeFiles } from "@jobhub/coach-knowledge";
import { TASK_PLAYBOOKS, type TaskPlaybookSeed } from "@jobhub/coach-knowledge/tasks";
import type { PlaybookAgent, PlaybookSeed } from "./index";

/** Who validated the task Playbooks imported validated (ADR-0026). */
export const IMPORT_VALIDATOR = "François Nader";

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
    tasks: (TASK_PLAYBOOKS as readonly TaskPlaybookSeed[]).map((task) => {
      const first = task.firstVersion;
      const validatedBy = task.validatedAtImport ? IMPORT_VALIDATOR : null;
      if (!first) return { id: task.id, content: task.instructions, agent: taskAgent(env, task, task.agent), validatedBy };
      const small = taskAgent(env, task, task.agent, true);
      return { id: task.id, content: first.instructions, agent: taskAgent(env, task, first.agent), validatedBy, later: [{ content: task.instructions, agent: small }] };
    }),
  };
}

/** A task Playbook's imported Playbook Agent: its task's route here, with no effort; on its provider's smallest model when `small`. */
function taskAgent(env: Env, task: TaskPlaybookSeed, runsOne: boolean, small = false): PlaybookAgent | null {
  if (!runsOne) return null;
  const route = taskRouteFromEnv(env, task.aiTask as AiTask);
  const model = (small ? smallModelFromEnv(env, route.provider) : undefined) ?? route.model ?? null;
  return { provider: route.provider, model, effort: null, consultWhen: "" };
}
