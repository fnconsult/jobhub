/**
 * The AI Coach's reply to a Tailored CV request: asked for, read, and asked for
 * once more when refused. Callers get `askForTailoredCv(ai, request)`: the reply,
 * or null when two replies in a row were refused (or the AI layer failed).
 *
 * A refused reply is logged with why (`RefusalReason`), its length and the
 * provider and model, never its content: it holds the Candidate's CV and the
 * Job Offer. Each attempt is recorded in the usage log by the AI layer.
 */
import type { AiLayer, GenerateRequest } from "@jobhub/ai";
import * as z from "zod";

/**
 * What the AI Coach replies: its adaptation of the Master CV. A section it leaves
 * out or gets wrong (any item of the wrong shape) is undefined, and taken from the
 * Master CV as it is. Diplomas, languages and skills carry the id the Master CV's
 * item was given in the prompt.
 */
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const text = z.string().catch("");
const id = z.string().optional().catch(undefined);
const aiReply = z.object({
  headline: optional(z.string()),
  summary: optional(z.string()),
  experience: optional(z.array(z.object({ id, employer: z.string(), period: z.string(), title: text, description: text }))),
  education: optional(z.array(z.object({ id, degree: z.string(), institution: text, year: text }))),
  skills: optional(z.array(z.union([z.string().transform((skill) => ({ id: undefined, text: skill })), z.object({ id, text: z.string() })]))),
  languages: optional(z.array(z.object({ id, name: z.string(), level: text }))),
  /** Requirements of the Job Offer the Master CV does not show. */
  missing: z.array(z.string()).catch([]),
});
export type AiReply = z.output<typeof aiReply>;

/**
 * Why a reply is no proposal: it holds no JSON object, the object does not
 * parse, it is not the shape asked for, or it has no CV section at all (an
 * empty or truncated reply).
 */
export type RefusalReason = "no_json" | "bad_json" | "schema" | "no_cv";

export type ReadReply = { ok: true; reply: AiReply } | { ok: false; reason: RefusalReason };

/** The JSON object in the AI Coach's reply, or why it is refused. */
export function replyIn(reply: string): ReadReply {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "no_json" };
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  const parsed = aiReply.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema" };
  const { headline, summary, experience, education, skills, languages } = parsed.data;
  if ([headline, summary, experience, education, skills, languages].every((section) => section === undefined)) return { ok: false, reason: "no_cv" };
  return { ok: true, reply: parsed.data };
}

/** Attempts per proposal: the first, and one more when it is refused. */
const ATTEMPTS = 2;

/** The AI Coach's Tailored CV reply to `request`, asked for once more if refused; null if none came. */
export async function askForTailoredCv(ai: AiLayer, request: GenerateRequest): Promise<AiReply | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let generated;
    try {
      generated = await ai.generate(request);
    } catch (error) {
      console.warn("[tailored-cv] the AI Coach could not propose a Tailored CV:", error instanceof Error ? error.message : error);
      return null;
    }
    const read = replyIn(generated.text);
    if (read.ok) return read.reply;
    console.warn(
      `[tailored-cv] refused the AI Coach's Tailored CV reply (attempt ${attempt}/${ATTEMPTS}): reason=${read.reason} length=${generated.text.length} provider=${generated.provider} model=${generated.model}`,
    );
  }
  return null;
}
