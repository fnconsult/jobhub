/**
 * Reading a Job Offer's text with an LLM, for what its structured (JobPosting) data does not give:
 *  - `readJobPage`: Job discovery's fallback for a page without JobPosting data — is it one job
 *    posting, and what does it state (title, full text and the fields below)?
 *  - `readOfferFields`: the second phase of a Match Score — the fields a stored Job Offer lacks,
 *    read from its text (no copy of the text back, so the reply stays short and quick).
 * Both also write the Job Offer Summary: two or three sentences on the role, its scope and what is
 * expected, in the offer's own language, inventing nothing (ADR-0006).
 * Both carry public posting text only, never the Candidate's CV or identity: they run as the
 * `offer_analysis` task, which carries no personal data (ADR-0007).
 */
import { CONTRACT_TYPES, JOB_OFFER_SUMMARY_MAX_CHARS, REMOTE_WORK_OPTIONS, type JobOfferDetails } from "@jobhub/shared";
import type { AiLayer } from "./ai-layer";

/** Enough text for any real posting, while keeping the call cheap. */
const MAX_PAGE_CHARS = 30_000;

/**
 * The fields of a Job Offer an LLM can read from its text: those the Match Score and the Company Dossier use,
 * and the Job Offer Summary.
 */
export type OfferFields = Pick<
  JobOfferDetails,
  "employer" | "location" | "contractType" | "remoteWork" | "salary" | "skills" | "requiredExperienceYears" | "summary"
>;

const FIELDS_SCHEMA = `"employer"?: string, "location"?: string,
 "contractType"?: ${CONTRACT_TYPES.map((t) => `"${t}"`).join(" | ")}, "remoteWork"?: ${REMOTE_WORK_OPTIONS.map((t) => `"${t}"`).join(" | ")},
 "salaryMin"?: number, "salaryMax"?: number, "skills"?: string[], "requiredExperienceYears"?: number, "summary": string`;

const FIELDS_RULES = `- Salaires en euros bruts annuels. N'invente rien : omets un champ que l'offre ne précise pas.
- "summary" : deux ou trois phrases (400 caractères au plus) sur le poste, son périmètre et ce qui est attendu,
  écrites dans la langue de l'offre (en anglais pour une offre en anglais). Uniquement ce que l'offre dit, sans rien inventer
  ni juger, et sans nom de personne (recruteur, manager).`;

const PAGE_SYSTEM = `Tu lis le texte d'une page web trouvée par une recherche d'offres d'emploi.
Réponds uniquement par un objet JSON, sans texte autour.
Si la page n'est pas UNE offre d'emploi précise (liste d'offres, article, page d'accueil, offre expirée), réponds {"isJobOffer": false}.
Sinon réponds :
{"isJobOffer": true, "title": string, "content": string, ${FIELDS_SCHEMA}}
- "content" : le texte complet de l'offre, recopié tel quel, sans la navigation ni le pied de page du site.
${FIELDS_RULES}`;

const FIELDS_SYSTEM = `Tu lis le texte d'une offre d'emploi.
Réponds uniquement par un objet JSON, sans texte autour :
{${FIELDS_SCHEMA}}
- "location" : la ville (et le pays s'il est indiqué) où se trouve le poste.
- "skills" : les compétences demandées, en quelques mots chacune (au plus 15).
- "requiredExperienceYears" : le nombre minimal d'années d'expérience demandé.
${FIELDS_RULES}`;

type Json = Record<string, unknown>;

function parseJson(reply: string): Json | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const value: unknown = JSON.parse(reply.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined);
const oneOf = <T extends string>(allowed: readonly T[], value: unknown) => (allowed.includes(value as T) ? (value as T) : undefined);

/** A Job Offer Summary of the right shape: text, its spacing tidied, not too long. */
function summaryFrom(value: unknown): string | undefined {
  const text = str(value)?.replace(/\s+/g, " ");
  return text && text.length <= JOB_OFFER_SUMMARY_MAX_CHARS ? text : undefined;
}

/** The fields the reply states, each checked: anything of the wrong shape is left out. */
function fieldsFrom(reply: Json): OfferFields {
  const fields: OfferFields = {};
  const employer = str(reply.employer);
  if (employer) fields.employer = employer;
  const location = str(reply.location);
  if (location) fields.location = location;
  const contractType = oneOf(CONTRACT_TYPES, reply.contractType);
  if (contractType) fields.contractType = contractType;
  const remoteWork = oneOf(REMOTE_WORK_OPTIONS, reply.remoteWork);
  if (remoteWork) fields.remoteWork = remoteWork;
  const min = positive(reply.salaryMin);
  const max = positive(reply.salaryMax);
  if (min !== undefined || max !== undefined) fields.salary = { ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
  const skills = Array.isArray(reply.skills) ? reply.skills.map(str).filter((s): s is string => Boolean(s)) : [];
  if (skills.length) fields.skills = skills;
  const years = typeof reply.requiredExperienceYears === "number" && reply.requiredExperienceYears >= 0 ? Math.round(reply.requiredExperienceYears) : undefined;
  if (years !== undefined) fields.requiredExperienceYears = years;
  const summary = summaryFrom(reply.summary);
  if (summary) fields.summary = summary;
  return fields;
}

/** The Job Offer details the LLM reads from the page text, or null if it is not one job posting. */
export async function readJobPage(ai: AiLayer, candidateId: string | null, pageText: string): Promise<JobOfferDetails | null> {
  const { text } = await ai.generate({
    task: "offer_analysis",
    candidateId,
    system: PAGE_SYSTEM,
    prompt: pageText.slice(0, MAX_PAGE_CHARS),
    maxTokens: 8192,
  });
  const reply = parseJson(text);
  if (!reply || reply.isJobOffer !== true) return null;
  const title = str(reply.title);
  const content = str(reply.content);
  if (!title || !content) return null;
  return { title, content, ...fieldsFrom(reply) };
}

/**
 * The fields a Job Offer's text states (its title and text only). Empty when it states none;
 * throws what the AI layer throws, or when the reply is not a JSON object.
 */
export async function readOfferFields(
  ai: AiLayer,
  { candidateId, jobOffer }: { candidateId: string | null; jobOffer: Pick<JobOfferDetails, "title" | "content"> },
): Promise<OfferFields> {
  const { text } = await ai.generate({
    task: "offer_analysis",
    candidateId,
    system: FIELDS_SYSTEM,
    prompt: `${jobOffer.title}\n\n${jobOffer.content}`.slice(0, MAX_PAGE_CHARS),
    // Fields and a short summary, never the text back: a short reply, so the Match Score is not kept waiting.
    maxTokens: 1024,
    containsIdentity: false,
  });
  const reply = parseJson(text);
  if (!reply) throw new Error("The offer_analysis reply is not a JSON object");
  return fieldsFrom(reply);
}
