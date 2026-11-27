/**
 * What the AI Coach says of its own reply, on last lines the Candidate never sees: no extra AI call.
 *
 *   system += REPLY_MARKS_RULE;
 *   const { text, aboutJobbbox, couldNotAnswer } = readReplyMarks(reply);
 *
 * - `aboutJobbbox` (#344, ADR-0035): the Candidate's latest message asks how to use Jobbbox (a page, a term of the
 *   application, its quotas, the account or the subscription), as opposed to job-search advice. What an Unanswered
 *   Question is recorded on.
 * - `couldNotAnswer` (#345, ADR-0035): the AI Coach could not answer the question. The Coach Panel then offers
 *   « Poser la question à l'équipe » at once, without waiting for the Candidate's « Non ».
 *
 * A reply without a line says no: not about Jobbbox, answered. The lines are read in either order.
 */

const YES = "[jobbbox:oui]";
const NO = "[jobbbox:non]";
/** The line that offers « Poser la question à l'équipe » (#345). */
export const NOT_ANSWERED_MARK = "[sans-reponse]";
const NOT_ANSWERED = NOT_ANSWERED_MARK;

export const REPLY_MARKS_RULE = `Classement de la question : termine toujours ta réponse par une dernière ligne, seule, que le candidat ne verra pas : ${YES} si son dernier message demande comment utiliser Jobbbox (une page, un bouton, un terme de l'application, ses quotas, son compte, son abonnement, ses données), ${NO} sinon (un conseil sur sa recherche d'emploi, son CV, une candidature, un entretien).
Question sans réponse : si tu ne peux pas répondre à sa question (l'information te manque, ou seule l'équipe Jobbbox peut y répondre : son compte, un paiement, un problème technique ; jamais une chose que le candidat fait lui-même dans Jobbbox), ajoute juste avant cette dernière ligne une ligne seule, que le candidat ne verra pas : ${NOT_ANSWERED}. Ne l'ajoute jamais quand tu as répondu.`;

const LAST_LINE = /\s*\[(jobbbox:oui|jobbbox:non|sans-reponse)\]\s*$/i;

/** The reply as the Candidate sees it, without its last lines, and what they said. */
export function readReplyMarks(reply: string): { text: string; aboutJobbbox: boolean; couldNotAnswer: boolean } {
  let text = reply;
  let aboutJobbbox = false;
  let couldNotAnswer = false;
  for (let marked = LAST_LINE.exec(text); marked; marked = LAST_LINE.exec(text)) {
    const mark = marked[1]!.toLowerCase();
    if (mark === "sans-reponse") couldNotAnswer = true;
    else aboutJobbbox = mark === "jobbbox:oui";
    text = text.slice(0, marked.index);
  }
  return { text: text.trim(), aboutJobbbox, couldNotAnswer };
}
