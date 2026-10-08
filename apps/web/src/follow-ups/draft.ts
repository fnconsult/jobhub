/**
 * The Follow-up email draft, in the Application's Document Language. Internal
 * to Follow-ups. Written by the AI Coach when an AI layer is given and answers;
 * otherwise, from a plain template, so a Follow-up is always proposed.
 * Drafts only (ADR-0005): nothing here sends anything.
 */
import type { AiLayer } from "@jobhub/ai";
import type { DocumentLanguage } from "@jobhub/shared";
import * as z from "zod";

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

const SYSTEM: Record<DocumentLanguage, (followUpNumber: number) => string> = {
  fr: (n) =>
    `Tu es le coach Jobbbox. Tu rédiges un e-mail de relance${n > 1 ? " (deuxième relance)" : ""} en français, court (120 mots au plus), pour un cadre expérimenté resté sans réponse après sa candidature à l'offre ci-dessous.
Règles :
- Appuie-toi uniquement sur l'offre. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ne nomme aucune personne de l'entreprise.
- Ton courtois, sobre et concret, sans insistance.
Réponds uniquement avec un objet JSON : {"subject": "objet de l'e-mail", "text": "texte de l'e-mail"}.`,
  en: (n) =>
    `You are the Jobbbox coach. You write a short follow-up email${n > 1 ? " (second follow-up)" : ""} in English (120 words at most) for an experienced professional who has heard nothing back since applying to the job offer below.
Rules:
- Draw only on the job offer. Never invent experience, degrees or figures.
- Do not name anyone at the company.
- Courteous, plain and concrete, never pushy.
Reply with a JSON object only: {"subject": "the email subject", "text": "the email text"}.`,
};

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

/** The Follow-up draft: the AI Coach's, or the template's when there is no AI layer or it fails. */
export async function followUpDraft(request: FollowUpDraftRequest): Promise<FollowUpDraft> {
  const { ai, candidateId, language, jobOffer, followUpNumber } = request;
  const fallback = template(language, jobOffer.title, jobOffer.employer, followUpNumber);
  if (!ai) return fallback;
  try {
    const { text } = await ai.generate({
      task: "writing",
      candidateId,
      system: SYSTEM[language](followUpNumber),
      prompt: JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, content: jobOffer.content }),
    });
    const written = parsed(text);
    return written ? { subject: written.subject || fallback.subject, text: written.text } : fallback;
  } catch (error) {
    console.warn("[follow-ups] the AI Coach could not write the Follow-up:", error instanceof Error ? error.message : error);
    return fallback;
  }
}
