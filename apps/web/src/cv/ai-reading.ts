/**
 * The AI Coach's reading of a CV's text (task `cv_parsing`, EU endpoints only,
 * ADR-0007). Returns null when the reply cannot be used, so the caller can fall
 * back to the rule-based outline. Its instructions and the AI running it are the
 * "cv-reading" task Playbook's (ADR-0026); the JSON shape it is read with stays here.
 */
import { createProvenanceRecorder, type AiLayer } from "@jobhub/ai";
import type { Provenance, ProvenanceEvent } from "@jobhub/shared";
import { taskRun, type TaskPlaybookReader } from "../task-playbooks";
import { distinctLocations } from "@jobhub/shared";
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
  // The AI names one place, where the Candidate lives: the draft's only location, if any.
  searchCriteria: z
    .object({ targetRole: text, location: text })
    .catch({ targetRole: "", location: "" })
    .transform(({ targetRole, location }) => ({ targetRole, locations: distinctLocations([location]) })),
});

/** The shape the reply is read with (`readingSchema`), after the task Playbook's instructions. */
const SHAPE = `Réponds uniquement avec le JSON, au format :
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

/** How the reading runs: the "cv-reading" task Playbook, the Candidate's Stop, and where its step is told (#335). */
export interface ReadingOptions {
  taskPlaybooks?: TaskPlaybookReader;
  signal?: AbortSignal;
  onEvent?: (event: ProvenanceEvent) => void;
}

/**
 * `ai` is resolved here, inside the fallback: an invalid AI configuration
 * (`AiConfigError`, whose message names the missing setting, never its value)
 * falls back to the rule-based outline like any other AI failure. A failed call, or one
 * whose reply is not usable JSON, is recorded with `cv_reading_fallback` (#260); an AI
 * layer that cannot be built makes no call, so its warning stays on the console.
 * The reading comes with its Provenance (#335), its site the Candidate's own CV (their data, no link).
 * Stopped (`signal`), it is null too: the caller tells a Stop from a failure by the signal.
 */
export async function readCvWithAi(
  cvText: string,
  ai: () => AiLayer,
  candidateId: string,
  { taskPlaybooks, signal, onEvent }: ReadingOptions = {},
): Promise<{ draft: CvDraft; provenance: Provenance } | null> {
  let reply: string;
  let recorder: ReturnType<typeof createProvenanceRecorder>;
  try {
    const layer = ai();
    recorder = createProvenanceRecorder(layer, { ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}) });
    const run = await taskRun(taskPlaybooks, "cv-reading", layer);
    ({ text: reply } = await recorder.ai.generate({
      task: "cv_parsing",
      candidateId,
      system: `${run.text()}\n${SHAPE}`,
      prompt: `CV :\n${cvText}`,
      containsIdentity: true,
      ...run.agent,
      fallback: "cv_reading_fallback",
      unusable: (text) => (readingSchema.safeParse(jsonIn(text)).success ? null : { reason: "cv_reading_fallback", detail: NOT_USABLE }),
    }));
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("[cv] AI reading of a CV failed, using the rule-based outline:", error instanceof Error ? error.message : error);
    return null;
  }
  const parsed = readingSchema.safeParse(jsonIn(reply));
  if (!parsed.success) {
    console.warn("[cv] AI reading of a CV was not usable JSON, using the rule-based outline");
    return null;
  }
  // Read from the Candidate's own CV, a file of theirs: their data, with no page to link to.
  return { draft: parsed.data, provenance: { ...recorder.provenance(), sites: [{ kind: "candidate", links: [] }] } };
}

/** Why a reply is not used: written by the code, never a part of the CV. */
const NOT_USABLE = "the reply is not usable JSON";
