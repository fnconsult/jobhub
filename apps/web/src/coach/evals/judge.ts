/**
 * The AI judge: scores one AI Coach reply against the coaching knowledge the reply drew on,
 * on three criteria, each from 1 (fails) to 5 (exemplary):
 *  - adherence: follows the Core Digest and the playbooks given, and does what the case expects;
 *  - figures: no figure or statistic that is not in those documents (5 = none outside them);
 *  - tone: right for a Candidate over 40 (respectful, concrete, no promised outcome, no ageism).
 */
import { costInEur, type AiLayer } from "@jobhub/ai";
import type { CoachKnowledge } from "@jobhub/coach-knowledge";
import * as z from "zod";
import type { PlaybookUsed } from "../index";
import type { CoachEvalCase } from "./cases";

const criterion = z.object({ score: z.number().int().min(1).max(5), reason: z.string() });

const judgmentSchema = z.object({
  adherence: criterion,
  figures: criterion.extend({ outside: z.array(z.string()) }),
  tone: criterion,
});

export type Judgment = z.infer<typeof judgmentSchema>;

export const JUDGE_CRITERIA = ["adherence", "figures", "tone"] as const satisfies readonly (keyof Judgment)[];

/** A reply passes when every criterion scores at least this. */
export const PASS_SCORE = 4;

const RULES = `Tu évalues la réponse du coach IA Jobbbox, un coach emploi pour des cadres et professionnels de plus de 40 ans qui cherchent un poste en France.
On te donne les connaissances de coaching que le coach avait (le socle et les playbooks), la conversation, sa réponse, et ce qu'une bonne réponse fait.
Note trois critères de 1 (échoue) à 5 (exemplaire) :
- "adherence" : la réponse applique les règles du socle et des playbooks donnés, sans les contredire, et fait ce qu'une bonne réponse fait.
- "figures" : aucun chiffre, pourcentage, durée chiffrée ou statistique qui ne figure pas dans le socle ou les playbooks donnés. 5 : aucun chiffre hors de ces documents ; 1 : une statistique inventée. Liste dans "outside" chaque chiffre hors de ces documents, tel qu'écrit dans la réponse. Les chiffres que le candidat a donnés lui-même ne comptent pas.
- "tone" : un ton adapté à un candidat de plus de 40 ans : respectueux, concret, sans jargon ni condescendance, sans âgisme, sans promettre de résultat, une recherche longue présentée comme un fait de marché et non un échec.
Réponds uniquement par un objet JSON, sans texte autour :
{"adherence":{"score":1,"reason":"..."},"figures":{"score":1,"outside":["..."],"reason":"..."},"tone":{"score":1,"reason":"..."}}`;

/** The documents a reply drew on, as the judge reads them. */
function knowledgeText(knowledge: Pick<CoachKnowledge, "playbook" | "coreDigest">, used: PlaybookUsed[]): string {
  const documents = used.flatMap((item) => {
    const document = item.id === "core-digest" ? knowledge.coreDigest() : knowledge.playbook(item.id);
    return document ? [`<document id="${item.id}" version="${item.version}">\n${document.text}\n</document>`] : [];
  });
  return documents.length > 0 ? documents.join("\n\n") : "(aucune connaissance de coaching servie)";
}

function promptFor(evalCase: CoachEvalCase, reply: string, knowledge: string): string {
  const conversation = evalCase.messages.map((message) => `${message.from === "candidate" ? "Candidat" : "Coach"} : ${message.text}`).join("\n");
  return [
    `<connaissances>\n${knowledge}\n</connaissances>`,
    `<conversation>\n${conversation}\n</conversation>`,
    `<reponse_du_coach>\n${reply}\n</reponse_du_coach>`,
    `<bonne_reponse>\n${evalCase.expected}\n</bonne_reponse>`,
  ].join("\n\n");
}

/** The JSON object in the judge's text, or null when there is none or it does not fit the criteria. */
function parseJudgment(text: string): Judgment | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const parsed = judgmentSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The judge's scores for one reply (null when its answer is not a valid judgment), and what judging cost. */
export async function judgeReply(
  judge: AiLayer,
  knowledge: Pick<CoachKnowledge, "playbook" | "coreDigest">,
  evalCase: CoachEvalCase,
  reply: { text: string; playbooks: PlaybookUsed[] },
): Promise<{ judgment: Judgment | null; model: string; eur: number }> {
  const result = await judge.generate({
    task: "coaching",
    candidateId: null,
    system: RULES,
    prompt: promptFor(evalCase, reply.text, knowledgeText(knowledge, reply.playbooks)),
    maxTokens: 2_000,
  });
  return { judgment: parseJudgment(result.text), model: result.model, eur: costInEur(result) };
}
