/**
 * The AI Coach's reading of a CV's text (task `cv_parsing`, EU endpoints only,
 * ADR-0007). Returns null when the reply cannot be used, so the caller can fall
 * back to the rule-based outline.
 */
import type { AiLayer } from "@jobhub/ai";
import * as z from "zod";
import type { CvDraft } from "./index";

const text = z.string().catch("");
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((value) => {
      const parsed = item.safeParse(value);
      return parsed.success ? [parsed.data as z.output<T>] : [];
    }));

const readingSchema = z.object({
  masterCv: z.object({
    fullName: text,
    headline: text,
    email: text,
    phone: text,
    location: text,
    summary: text,
    experience: list(z.object({ title: text, employer: text, location: text, period: text, description: text })),
    education: list(z.object({ degree: text, institution: text, year: text })),
    skills: list(z.string()),
    languages: list(z.object({ name: text, level: text })),
  }),
  searchCriteria: z.object({ targetRole: text, location: text }).catch({ targetRole: "", location: "" }),
});

const SYSTEM = `Tu lis le CV d'un candidat et tu le recopies, section par section, dans un objet JSON.
Règles :
- Recopie uniquement ce qui est écrit dans le CV, dans sa langue. N'invente, ne reformule et n'ajoute rien.
- Laisse une chaîne vide ("") ou une liste vide ([]) quand le CV ne dit rien.
- "period" et "level" sont recopiés tels qu'écrits (ex. "2015 – 2024", "courant").
- searchCriteria.targetRole : le poste que le candidat semble viser (titre du CV ou poste le plus récent).
- searchCriteria.location : la ville où il habite, si le CV l'indique.
Réponds uniquement avec le JSON, au format :
{"masterCv":{"fullName":"","headline":"","email":"","phone":"","location":"","summary":"",
"experience":[{"title":"","employer":"","location":"","period":"","description":""}],
"education":[{"degree":"","institution":"","year":""}],
"skills":[""],"languages":[{"name":"","level":""}]},
"searchCriteria":{"targetRole":"","location":""}}`;

/** The JSON object in a reply, with or without a Markdown code block around it. */
function jsonIn(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export async function readCvWithAi(cvText: string, ai: AiLayer, candidateId: string): Promise<CvDraft | null> {
  let reply: string;
  try {
    ({ text: reply } = await ai.generate({ task: "cv_parsing", candidateId, system: SYSTEM, prompt: `CV :\n${cvText}` }));
  } catch (error) {
    console.warn("[cv] AI reading of a CV failed, using the rule-based outline:", error instanceof Error ? error.message : error);
    return null;
  }
  const parsed = readingSchema.safeParse(jsonIn(reply));
  if (!parsed.success) {
    console.warn("[cv] AI reading of a CV was not usable JSON, using the rule-based outline");
    return null;
  }
  return parsed.data;
}
