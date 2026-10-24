/**
 * The Follow-up email draft, in the Application's Document Language. Internal
 * to Follow-ups. Written by the AI Coach when an AI layer is given and answers;
 * otherwise, from a plain template, so a Follow-up is always proposed. The AI Coach's
 * instructions and the AI writing it are the "follow-up" task Playbook's (ADR-0026).
 * Drafts only (ADR-0005): nothing here sends anything. A draft the AI Coach wrote
 * comes with its Provenance (#336); a template's has none (no model wrote it).
 */
import { createProvenanceRecorder, type AiLayer } from "@jobhub/ai";
import type { DocumentLanguage, Provenance } from "@jobhub/shared";
import * as z from "zod";
import { taskRun, type TaskPlaybookReader, type TaskRun } from "../task-playbooks";

export interface FollowUpDraft {
  subject: string;
  text: string;
}

export interface FollowUpDraftRequest {
  ai?: AiLayer;
  candidateId: string;
  language: DocumentLanguage;
  jobOffer: { title: string; employer: string | null; content: string };
  /** 1 for the first Follow-up, 2 for the second. */
  followUpNumber: number;
  /** The "follow-up" task Playbook's served version; without it, its built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
}

function template(language: DocumentLanguage, title: string, employer: string | null, followUpNumber: number): FollowUpDraft {
  if (language === "en") {
    const again = followUpNumber > 1 ? "I am coming back to you once more about" : "I am following up on";
    return {
      subject: `Following up on my application: ${title}`,
      text: `Hello,\n\n${again} my application for the ${title} position${employer ? ` at ${employer}` : ""}. I remain very interested and would be glad to discuss how my experience could help your team.\n\nCould you let me know where the recruitment stands?\n\nKind regards,`,
    };
  }
  const again = followUpNumber > 1 ? "Je me permets de revenir de nouveau vers vous au sujet de" : "Je me permets de revenir vers vous au sujet de";
  return {
    subject: `Relance de ma candidature : ${title}`,
    text: `Bonjour,\n\n${again} ma candidature au poste de ${title}${employer ? ` chez ${employer}` : ""}. Ce poste m'intéresse toujours vivement et je serais heureux d'échanger sur ce que mon expérience peut apporter à votre équipe.\n\nPourriez-vous m'indiquer où en est le recrutement ?\n\nBien cordialement,`,
  };
}

/** No one at the company is named, and the reply's shape: after the task Playbook's instructions. */
const RULES: Record<DocumentLanguage, string> = {
  fr: `- Ne nomme aucune personne de l'entreprise.
Réponds uniquement avec un objet JSON : {"subject": "objet de l'e-mail", "text": "texte de l'e-mail"}.`,
  en: `- Do not name anyone at the company.
Reply with a JSON object only: {"subject": "the email subject", "text": "the email text"}.`,
};

/** The "follow-up" task Playbook's section for the language and the Follow-up (1, or 2 for any later one), then the rules kept here. */
const systemPrompt = (run: TaskRun, language: DocumentLanguage, followUpNumber: number) => `${run.text(`${language} ${followUpNumber > 1 ? 2 : 1}`)}\n${RULES[language]}`;

const reply = z.object({ subject: z.string().catch(""), text: z.string() });

function parsed(answer: string): FollowUpDraft | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const result = reply.safeParse(JSON.parse(answer.slice(start, end + 1)));
    return result.success && result.data.text.trim() ? { subject: result.data.subject.trim(), text: result.data.text.trim() } : null;
  } catch {
    return null;
  }
}

/**
 * The Follow-up draft: the AI Coach's, with the Provenance of its writing, or the template's (Provenance null)
 * when there is no AI layer or it fails.
 */
export async function followUpDraft(request: FollowUpDraftRequest): Promise<{ draft: FollowUpDraft; provenance: Provenance | null }> {
  const { ai, candidateId, language, jobOffer, followUpNumber, taskPlaybooks } = request;
  const fallback = { draft: template(language, jobOffer.title, jobOffer.employer, followUpNumber), provenance: null };
  if (!ai) return fallback;
  try {
    const run = await taskRun(taskPlaybooks, "follow-up", ai);
    const recorder = createProvenanceRecorder(ai);
    const { text } = await recorder.ai.generate({
      task: "writing",
      candidateId,
      system: systemPrompt(run, language, followUpNumber),
      ...run.agent,
      prompt: JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, content: jobOffer.content }),
    });
    const written = parsed(text);
    return written ? { draft: { subject: written.subject || fallback.draft.subject, text: written.text }, provenance: recorder.provenance() } : fallback;
  } catch (error) {
    console.warn("[follow-ups] the AI Coach could not write the Follow-up:", error instanceof Error ? error.message : error);
    return fallback;
  }
}
