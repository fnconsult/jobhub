/**
 * Whether the Candidate's latest message asks how to use Jobbbox (#344, ADR-0035): a page, a term of the
 * application, its quotas, the account or the subscription, as opposed to job-search advice. The AI Coach
 * says so itself, on a last line of its reply that the Candidate never sees: no extra AI call.
 *
 *   system += ABOUT_JOBBBOX_RULE;
 *   const { text, aboutJobbbox } = readAboutJobbbox(reply);
 *
 * What an Unanswered Question is recorded on. A reply without the line is not about Jobbbox: nothing is recorded.
 */

const YES = "[jobbbox:oui]";
const NO = "[jobbbox:non]";

export const ABOUT_JOBBBOX_RULE = `Classement de la question : termine toujours ta réponse par une dernière ligne, seule, que le candidat ne verra pas : ${YES} si son dernier message demande comment utiliser Jobbbox (une page, un bouton, un terme de l'application, ses quotas, son compte, son abonnement, ses données), ${NO} sinon (un conseil sur sa recherche d'emploi, son CV, une candidature, un entretien).`;

const LAST_LINE = /\s*\[jobbbox:(oui|non)\]\s*$/i;

/** The reply as the Candidate sees it, without its last line, and what that line said; false without one. */
export function readAboutJobbbox(reply: string): { text: string; aboutJobbbox: boolean } {
  const marked = LAST_LINE.exec(reply);
  if (!marked) return { text: reply.trim(), aboutJobbbox: false };
  return { text: reply.slice(0, marked.index).trim(), aboutJobbbox: marked[1]!.toLowerCase() === "oui" };
}
