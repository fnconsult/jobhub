/**
 * The fallback when a page has no JobPosting structured data: the LLM reads the
 * page text (public posting text only: the `offer_analysis` task carries no
 * personal data, ADR-0007) and says whether it is one job posting, and what it states.
 */
import type { AiLayer } from "@jobhub/ai";
import { CONTRACT_TYPES, REMOTE_WORK_OPTIONS, type JobOfferDetails } from "@jobhub/shared";

/** Enough text for any real posting, while keeping the call cheap. */
const MAX_PAGE_CHARS = 30_000;

const SYSTEM = `Tu lis le texte d'une page web trouvée par une recherche d'offres d'emploi.
Réponds uniquement par un objet JSON, sans texte autour.
Si la page n'est pas UNE offre d'emploi précise (liste d'offres, article, page d'accueil, offre expirée), réponds {"isJobOffer": false}.
Sinon réponds :
{"isJobOffer": true, "title": string, "content": string, "employer"?: string, "location"?: string,
 "contractType"?: ${CONTRACT_TYPES.map((t) => `"${t}"`).join(" | ")}, "remoteWork"?: ${REMOTE_WORK_OPTIONS.map((t) => `"${t}"`).join(" | ")},
 "salaryMin"?: number, "salaryMax"?: number, "skills"?: string[], "requiredExperienceYears"?: number}
- "content" : le texte complet de l'offre, recopié tel quel, sans la navigation ni le pied de page du site.
- Salaires en euros bruts annuels. N'invente rien : omets un champ que l'offre ne précise pas.`;

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

/** The Job Offer details the LLM reads from the page text, or null if it is not one job posting. */
export async function extractWithLlm(ai: AiLayer, candidateId: string | null, pageText: string): Promise<JobOfferDetails | null> {
  const { text } = await ai.generate({
    task: "offer_analysis",
    candidateId,
    system: SYSTEM,
    prompt: pageText.slice(0, MAX_PAGE_CHARS),
    maxTokens: 8192,
  });
  const reply = parseJson(text);
  if (!reply || reply.isJobOffer !== true) return null;
  const title = str(reply.title);
  const content = str(reply.content);
  if (!title || !content) return null;

  const details: JobOfferDetails = { title, content };
  const employer = str(reply.employer);
  if (employer) details.employer = employer;
  const location = str(reply.location);
  if (location) details.location = location;
  const contractType = oneOf(CONTRACT_TYPES, reply.contractType);
  if (contractType) details.contractType = contractType;
  const remoteWork = oneOf(REMOTE_WORK_OPTIONS, reply.remoteWork);
  if (remoteWork) details.remoteWork = remoteWork;
  const min = positive(reply.salaryMin);
  const max = positive(reply.salaryMax);
  if (min !== undefined || max !== undefined) details.salary = { ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
  const skills = Array.isArray(reply.skills) ? reply.skills.map(str).filter((s): s is string => Boolean(s)) : [];
  if (skills.length) details.skills = skills;
  const years = typeof reply.requiredExperienceYears === "number" && reply.requiredExperienceYears >= 0 ? Math.round(reply.requiredExperienceYears) : undefined;
  if (years !== undefined) details.requiredExperienceYears = years;
  return details;
}
