/**
 * The AI Coach's side of the Coach Panel: one reply to the conversation so far,
 * aware of what the Candidate has in view.
 *
 * One deep module. Callers get `createCoach({ ai, ...sources }).reply(candidateId, input)`
 * where `input` is untrusted (it comes from the browser): `{ messages, focus? }`.
 * It never throws for a bad conversation or a failing provider: it answers
 * `{ ok: false, error: "invalid" | "unavailable" }`. What the AI Coach is told
 * (the Candidate summary, the Coach Memory, the item In view, the summaries,
 * within COACH_CONTEXT_MAX_TOKENS and without the Candidate's identity) is read
 * here from the sources, scoped to the Candidate, so an id from someone else's
 * account adds nothing: see ./context. Task `coaching`, EU endpoints only (ADR-0007).
 * Each reply says what it cost (`CoachMessageCost`), so it can be recorded with
 * the message: an estimate from list prices, frozen at the time of the reply.
 * Each reply is grounded in the coaching knowledge `knowledge` serves: the Core Digest
 * and 1 or 2 Coaching Playbooks picked from what is In view and the message topic
 * (see ./grounding). The playbooks win over the model's general knowledge and are the
 * only place a figure may come from. The reply says which it used, with their versions
 * (`playbooks`), so they can be recorded with the message. All of it, the persona, the
 * knowledge and the context, stays within COACH_CONTEXT_MAX_TOKENS.
 */
import { costInEur, type AiLayer, type ProviderId } from "@jobhub/ai";
import type { CoachKnowledge } from "@jobhub/coach-knowledge";
import * as z from "zod";
import { COACH_CONTEXT_MAX_TOKENS, COACH_FOCUS_KINDS, coachContext, estimateTokens, type CoachSources } from "./context";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, recentConversation } from "./conversation";
import { grounding, type PlaybookUsed } from "./grounding";

export { COACH_CONTEXT_MAX_TOKENS, COACH_FOCUS_KINDS, estimateTokens, type CoachFocus, type CoachMemorySource, type CoachSources } from "./context";

export { MAX_MESSAGE_LENGTH, MAX_MESSAGES, recentConversation, type CoachMessage } from "./conversation";

export { KNOWLEDGE_MAX_TOKENS, MAX_PLAYBOOKS, type PlaybookUsed } from "./grounding";

/** What one AI Coach reply cost: who answered, its tokens, and the estimated cost in € at list prices. */
export interface CoachMessageCost {
  provider: ProviderId;
  model: string;
  /** Input not read from the provider's prompt cache. */
  inputTokens: number;
  outputTokens: number;
  /** Input read from the provider's prompt cache. */
  cachedInputTokens: number;
  eur: number;
}

/** `playbooks`: the Core Digest and the Coaching Playbooks the reply drew on, with their versions (none when nothing is served). */
export type CoachReply = { ok: true; reply: string; cost: CoachMessageCost; playbooks: PlaybookUsed[] } | { ok: false; error: "invalid" | "unavailable" };

export interface Coach {
  reply(candidateId: string, input: unknown): Promise<CoachReply>;
}

export interface CoachDeps extends CoachSources {
  ai: AiLayer;
  /** The Coaching Playbooks and Core Digest served in this environment (ADR-0019). */
  knowledge: Pick<CoachKnowledge, "playbook" | "coreDigest">;
}

/**
 * Most messages accepted in one call. Coach Conversations send their recent
 * window (MAX_MESSAGES) plus the new message; anything longer, up to this bound,
 * is trimmed to that window rather than refused.
 */
const MAX_MESSAGES_ACCEPTED = MAX_MESSAGES * 5;

const inputSchema = z.object({
  messages: z
    .array(z.object({ from: z.enum(["candidate", "coach"]), text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }))
    .min(1)
    .max(MAX_MESSAGES_ACCEPTED)
    .refine((messages) => messages.at(-1)?.from === "candidate"),
  focus: z.object({ kind: z.enum(COACH_FOCUS_KINDS), id: z.string().max(100) }).optional(),
});

const PERSONA = `Tu es le coach Jobbbox : un coach emploi bienveillant et concret pour des cadres et professionnels de plus de 40 ans qui cherchent un poste en France.
Règles :
- Réponds dans la langue du candidat, en phrases courtes et claires, sans jargon.
- En français, vouvoie toujours le candidat (« vous », « votre »), jamais « tu » ni « ton », même s'il te tutoie.
- Appuie-toi uniquement sur ce que le candidat t'a dit et sur les informations ci-dessous. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Si tu proposes une modification de son CV, dis précisément quoi changer et pourquoi.`;

/** How the AI Coach uses the coaching knowledge that follows it (the Core Digest and the playbooks). */
const GROUNDING_RULES = `Connaissances de coaching :
- Le socle et les playbooks Jobbbox ci-dessous priment sur tes connaissances générales : en cas de désaccord, suis-les.
- N'avance aucun chiffre ni statistique qui ne figure pas dans le socle ou un playbook ci-dessous.
- Quand tu t'appuies sur un chiffre ou une étude, cite sa source en clair, par son auteur et son année (par exemple « Apec, 2026 »), jamais par son identifiant [S…].
- Là où ils ne disent rien, donne un conseil général, sans chiffre.`;

export function createCoach(deps: CoachDeps): Coach {
  return {
    async reply(candidateId, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { focus } = parsed.data;
      const messages = recentConversation(parsed.data.messages);
      try {
        const knowledge = grounding(deps.knowledge, { inView: focus?.kind, message: messages.at(-1)!.text });
        const instructions = [PERSONA, GROUNDING_RULES, knowledge.text].filter(Boolean).join("\n\n");
        // Room left for the context once the persona and the knowledge are in: the whole system prompt stays under the cap.
        const context = await coachContext(deps, candidateId, focus, COACH_CONTEXT_MAX_TOKENS - estimateTokens(instructions) - 1);
        const result = await deps.ai.generate({
          task: "coaching",
          candidateId,
          system: `${instructions}\n\n${context}`,
          // First name only, the Master CV's identity stripped (#126): the AI layer's scan stays the safety net (#121).
          containsIdentity: false,
          prompt: messages.map((message) => ({ role: message.from === "candidate" ? ("user" as const) : ("assistant" as const), content: message.text })),
        });
        const { provider, model, usage } = result;
        const cost: CoachMessageCost = {
          provider,
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens ?? 0,
          eur: costInEur(result),
        };
        return { ok: true, reply: result.text.trim(), cost, playbooks: knowledge.used };
      } catch (error) {
        console.warn("[coach] the AI Coach could not reply:", error instanceof Error ? error.message : error);
        return { ok: false, error: "unavailable" };
      }
    },
  };
}
