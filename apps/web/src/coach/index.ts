/**
 * The AI Coach's side of the Coach Panel: one reply to the conversation so far,
 * aware of what the Candidate has in view.
 *
 * One deep module. Callers get `createCoach({ ai, profiles }).reply(candidateId, input)`
 * where `input` is untrusted (it comes from the browser): `{ messages, focus? }`.
 * It never throws for a bad conversation or a failing provider: it answers
 * `{ ok: false, error: "invalid" | "unavailable" }`. The in-view Profile is
 * read here, scoped to the Candidate, so a Profile id from someone else's
 * account adds nothing. Task `coaching`, EU endpoints only (ADR-0007).
 */
import type { AiLayer } from "@jobhub/ai";
import * as z from "zod";
import type { Profiles } from "@/profiles";

/** What the Candidate has in view while talking to the AI Coach. */
export type CoachFocus = { kind: "profile"; id: string } | { kind: "application"; id: string };

export interface CoachMessage {
  from: "candidate" | "coach";
  text: string;
}

export type CoachReply = { ok: true; reply: string } | { ok: false; error: "invalid" | "unavailable" };

export interface Coach {
  reply(candidateId: string, input: unknown): Promise<CoachReply>;
}

export interface CoachDeps {
  ai: AiLayer;
  profiles: Pick<Profiles, "get">;
}

/** Longest single message, and longest conversation, sent to the AI Coach. */
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_MESSAGES = 40;

const inputSchema = z.object({
  messages: z
    .array(z.object({ from: z.enum(["candidate", "coach"]), text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }))
    .min(1)
    .max(MAX_MESSAGES)
    .refine((messages) => messages.at(-1)?.from === "candidate"),
  focus: z.object({ kind: z.enum(["profile", "application"]), id: z.string().max(100) }).optional(),
});

const PERSONA = `Tu es le coach Jobbbox : un coach emploi bienveillant et concret pour des cadres et professionnels de plus de 40 ans qui cherchent un poste en France.
Règles :
- Réponds dans la langue du candidat, en phrases courtes et claires, sans jargon.
- Appuie-toi uniquement sur ce que le candidat t'a dit et sur les informations ci-dessous. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Si tu proposes une modification de son CV, dis précisément quoi changer et pourquoi.`;

export function createCoach(deps: CoachDeps): Coach {
  async function context(candidateId: string, focus: CoachFocus | undefined): Promise<string> {
    // Applications do not exist yet: an Application in view adds nothing until they do.
    if (focus?.kind !== "profile") return "Le candidat ne consulte aucun profil en ce moment.";
    const profile = await deps.profiles.get(candidateId, focus.id);
    if (!profile) return "Le candidat ne consulte aucun profil en ce moment.";
    return [
      `Le candidat consulte son profil « ${profile.name} ».`,
      `Critères de recherche : ${JSON.stringify(profile.searchCriteria)}`,
      `CV de référence (version ${profile.masterCv.version}) : ${JSON.stringify(profile.masterCv.content)}`,
    ].join("\n");
  }

  return {
    async reply(candidateId, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { messages, focus } = parsed.data;
      try {
        const { text } = await deps.ai.generate({
          task: "coaching",
          candidateId,
          system: `${PERSONA}\n\n${await context(candidateId, focus)}`,
          prompt: messages.map((message) => ({ role: message.from === "candidate" ? ("user" as const) : ("assistant" as const), content: message.text })),
        });
        return { ok: true, reply: text.trim() };
      } catch (error) {
        console.warn("[coach] the AI Coach could not reply:", error instanceof Error ? error.message : error);
        return { ok: false, error: "unavailable" };
      }
    },
  };
}
