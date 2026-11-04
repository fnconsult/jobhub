/**
 * The Candidate's objects as the read Coach Actions find them (#714): through the domain modules the pages' routes use,
 * scoped to the Candidate, Archived Profiles and their Applications, Job Searches and Job Digests left out (not_found).
 * Each object is told as the Coach context tells it In view (../coach/context), without the Identity block, then fitted
 * to the room it is given by rule: the fullest telling that fits, else a shorter one (a Master CV without its job
 * descriptions, fewer Job Offers), else cut.
 */
import { NO_INDUSTRY_REFERENCE, type DocumentLanguage, type IndustryReference } from "@jobhub/shared";
import type { Applications } from "../applications";
import { applicationDetails, criteriaTextOf, APPLICATION_STATUS, cvText, day, JOB_SEARCH_STATUS, jobOfferHeadline, jobOfferText, matchScoreText, scoredResultLine, type CoachAgendaSource } from "../coach/context";
import type { JobDigests } from "../job-digests";
import type { JobSearches } from "../job-searches";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import type { ApplicationTailoredCv, TailoredCvs } from "../tailored-cv";
import type { OutreachChannel, TailoredDocuments } from "../tailored-documents";
import { fitted, fittedLines, type CoachObjectReader, type IndexedObject, type ReadObject } from "./reads";

/** The domain modules the reads go through, each scoped to the Candidate. */
export interface CandidateObjectSources {
  profiles: Pick<Profiles, "get" | "list">;
  applications: Pick<Applications, "get" | "list">;
  jobSearches: Pick<JobSearches, "get" | "list">;
  jobDigests: Pick<JobDigests, "get" | "list">;
  agenda: CoachAgendaSource;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  /** The Sectors' and Domains' labels; without them none is named. */
  industries?: () => Promise<IndustryReference>;
  now?: () => Date;
}

type ScoredResult = Parameters<typeof scoredResultLine>[0];

/** How many of the Candidate's latest Job Searches, and of their latest Job Digests, a Job Offer is looked for in. */
export const JOB_OFFER_LOOKUP = 10;

/** A Job Search's or Job Digest's Job Offers, best Match Score first, each with its id, within `maxTokens`. */
function resultsText(head: string, results: readonly ScoredResult[], maxTokens: number): string {
  if (results.length === 0) return `${head}\nAucune offre trouvée.`;
  const lines = [...results].sort((a, b) => b.matchScore.score - a.matchScore.score).map((result) => `- [offre ${result.jobOffer.id}] ${scoredResultLine(result)}`);
  return fittedLines(`${head}\nOffres, meilleur score d'abord :`, lines, maxTokens, (count) => `(${count} autres offres, moins bien notées, ne sont pas montrées.)`);
}

const LANGUAGE: Record<DocumentLanguage, string> = { fr: "en français", en: "en anglais" };
const OUTREACH_CHANNEL: Record<OutreachChannel, string> = { email: "e-mail", inmail: "InMail LinkedIn" };
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A Tailored CV in one line, by rule: whether it is saved or proposed, when, its language and Match Scores; never its content. */
function tailoredCvLine(tailoredCv: ApplicationTailoredCv | null): string {
  const scores = ({ master, tailored }: { master: number; tailored: number }) => `score de correspondance ${master} avec le CV de référence, ${tailored} avec le CV adapté`;
  const proposal = tailoredCv?.proposal;
  const pending = proposal
    ? ` Une proposition du ${day(proposal.proposedAt)} attend la relecture du candidat (${proposal.questions.filter((question) => question.answer === null).length} questions sans réponse, ${scores(proposal.matchScore)}).`
    : "";
  const saved = tailoredCv?.saved;
  return `CV adapté : ${saved ? `enregistré le ${day(saved.savedAt)}, ${LANGUAGE[saved.language]}, ${scores(saved.matchScore)}.` : "aucun enregistré."}${pending}`;
}

/** A Cover Letter or Outreach Message in one line, by rule: when it was drafted and changed, its language and length; never its text. */
function draftLine(label: string, drafted: string, changed: string, none: string, draft: { language: DocumentLanguage; text: string; draftedAt: Date; updatedAt: Date } | null, how = ""): string {
  if (!draft) return `${label} : ${none}.`;
  const edited = draft.updatedAt.getTime() > draft.draftedAt.getTime() ? `, ${changed} le ${day(draft.updatedAt)}` : "";
  return `${label} : ${drafted} le ${day(draft.draftedAt)}${edited}, ${LANGUAGE[draft.language]}${how}, ${words(draft.text)} mots.`;
}

export function candidateObjects(sources: CandidateObjectSources): CoachObjectReader {
  const criteriaText = async () => criteriaTextOf(await (sources.industries?.().catch(() => NO_INDUSTRY_REFERENCE) ?? NO_INDUSTRY_REFERENCE));

  /** Whether `profileId` is one of the Candidate's active Profiles: an Archived Profile's objects are out of reach. */
  const isActive = async (candidateId: string, profileId: string) => (await sources.profiles.list(candidateId)).some((profile) => profile.id === profileId && !profile.archived);

  /**
   * A Job Offer one of the Candidate's objects shows, with its Match Score: their Application for it first, else the latest
   * of their JOB_OFFER_LOOKUP Job Searches, else of their JOB_OFFER_LOOKUP Job Digests (active Profiles only) that holds it.
   */
  async function jobOfferRead(candidateId: string, id: string, maxTokens: number): Promise<ReadObject | null> {
    const active = new Set((await sources.profiles.list(candidateId)).filter((profile) => !profile.archived).map((profile) => profile.id));
    const told = (head: string, result: ScoredResult) => fitted([[head, `${matchScoreText(result.matchScore)}.`, jobOfferText(result.jobOffer)].join("\n")], maxTokens);

    const saved = (await sources.applications.list(candidateId)).find((application) => application.jobOffer.id === id && active.has(application.profile.id));
    const application = saved ? await sources.applications.get(candidateId, saved.id) : null;
    if (application) {
      const head = `Offre d'emploi (id ${id}), enregistrée comme candidature (id ${application.id}), profil « ${application.profile.name} ».`;
      return { text: told(head, application), pages: [routes.application(application.id)], untrusted: true };
    }
    for (const summary of (await sources.jobSearches.list(candidateId)).filter((each) => active.has(each.profile.id)).slice(0, JOB_OFFER_LOOKUP)) {
      const jobSearch = await sources.jobSearches.get(candidateId, summary.id);
      const result = jobSearch?.results.find((each) => each.jobOffer.id === id);
      if (!jobSearch || !result) continue;
      const head = `Offre d'emploi (id ${id}), trouvée par la recherche d'offres (id ${jobSearch.id}) du ${day(jobSearch.startedAt)}, profil « ${jobSearch.profile.name} »${result.applicationId ? `, enregistrée comme candidature (id ${result.applicationId})` : ""}.`;
      return { text: told(head, result), pages: [routes.jobSearchOffer(jobSearch.id, id)], untrusted: true };
    }
    for (const summary of (await sources.jobDigests.list(candidateId)).filter((each) => active.has(each.profile.id)).slice(0, JOB_OFFER_LOOKUP)) {
      const jobDigest = await sources.jobDigests.get(candidateId, summary.id);
      const result = jobDigest?.results.find((each) => each.jobOffer.id === id);
      if (!jobDigest || !result) continue;
      const head = `Offre d'emploi (id ${id}), envoyée par le Job Digest (id ${jobDigest.id}) du ${day(jobDigest.sentAt)}, profil « ${jobDigest.profile.name} »${result.applicationId ? `, enregistrée comme candidature (id ${result.applicationId})` : ""}.`;
      return { text: told(head, result), pages: [routes.jobDigestOffer(jobDigest.id, id)], untrusted: true };
    }
    return null;
  }

  return {
    async index(candidateId) {
      const now = sources.now?.() ?? new Date();
      const [profiles, applications, jobSearches, jobDigests, agenda] = await Promise.all([
        sources.profiles.list(candidateId),
        sources.applications.list(candidateId),
        sources.jobSearches.list(candidateId),
        sources.jobDigests.list(candidateId),
        sources.agenda.upcoming(candidateId, now),
      ]);
      const active = new Set(profiles.filter((profile) => !profile.archived).map((profile) => profile.id));
      const archivedApplications = new Set(applications.filter((application) => !active.has(application.profile.id)).map((application) => application.id));
      const offers = (count: number) => `${count} offre${count > 1 ? "s" : ""}`;
      return [
        ...profiles.filter((profile) => active.has(profile.id)).map((profile): IndexedObject => ({ type: "profile", id: profile.id, title: profile.name, status: "actif" })),
        ...applications
          .filter((application) => !archivedApplications.has(application.id))
          .map((application): IndexedObject => ({
            type: "application",
            id: application.id,
            title: `${jobOfferHeadline(application.jobOffer)}, profil « ${application.profile.name} »`,
            status: APPLICATION_STATUS[application.status],
            date: application.statusChangedAt,
            untrusted: true,
          })),
        ...jobSearches
          .filter((jobSearch) => active.has(jobSearch.profile.id))
          .map((jobSearch): IndexedObject => ({
            type: "job_search",
            id: jobSearch.id,
            title: `Recherche d'offres du profil « ${jobSearch.profile.name} », ${offers(jobSearch.found)}`,
            status: JOB_SEARCH_STATUS[jobSearch.status],
            date: jobSearch.startedAt,
          })),
        ...jobDigests
          .filter((jobDigest) => active.has(jobDigest.profile.id))
          .map((jobDigest): IndexedObject => ({ type: "job_digest", id: jobDigest.id, title: `Job Digest du profil « ${jobDigest.profile.name} », ${offers(jobDigest.count)}`, status: "envoyé", date: jobDigest.sentAt })),
        ...agenda
          .filter((item) => item.kind !== "interview" || !archivedApplications.has(item.applicationId))
          .map((item): IndexedObject =>
            item.kind === "interview"
              ? {
                  type: "agenda_item",
                  id: item.id,
                  title: `Entretien pour ${item.jobTitle}${item.employer ? ` chez ${item.employer}` : ""} (candidature ${item.applicationId})`,
                  status: item.cancelledAt ? "annulé" : "prévu",
                  date: item.scheduledAt,
                  untrusted: true,
                }
              : { type: "agenda_item", id: item.id, title: `Séance de coaching avec ${item.coach.name}`, status: "prévue", date: item.scheduledAt },
          ),
      ];
    },

    async read(candidateId, type, id, maxTokens): Promise<ReadObject | null> {
      switch (type) {
        case "profile": {
          const profile = await sources.profiles.get(candidateId, id);
          if (!profile || profile.archived) return null;
          const criteria = (await criteriaText())(profile.searchCriteria);
          const told = (descriptions: boolean) =>
            [`Profil « ${profile.name} » (id ${profile.id}).`, `Critères de recherche : ${criteria}.`, `CV de référence (version ${profile.masterCv.version}) :`, cvText(profile.masterCv.content, { descriptions })].join("\n");
          return { text: fitted([told(true), told(false)], maxTokens), pages: [routes.profile(profile.id)], untrusted: false };
        }
        case "application": {
          const application = await sources.applications.get(candidateId, id);
          if (!application || !(await isActive(candidateId, application.profile.id))) return null;
          const text = [`Candidature (id ${application.id}) avec le profil « ${application.profile.name} » (id ${application.profile.id}).`, applicationDetails(application)].join("\n");
          return { text: fitted([text], maxTokens), pages: [routes.application(application.id)], untrusted: true };
        }
        case "job_offer":
          return jobOfferRead(candidateId, id, maxTokens);
        case "job_search": {
          const jobSearch = await sources.jobSearches.get(candidateId, id);
          if (!jobSearch || !(await isActive(candidateId, jobSearch.profile.id))) return null;
          const head = `Recherche d'offres (id ${jobSearch.id}) lancée le ${day(jobSearch.startedAt)} pour le profil « ${jobSearch.profile.name} » (${JOB_SEARCH_STATUS[jobSearch.status]}).`;
          return { text: resultsText(head, jobSearch.results, maxTokens), pages: [routes.jobSearch(jobSearch.id)], untrusted: true };
        }
        case "job_digest": {
          const jobDigest = await sources.jobDigests.get(candidateId, id);
          if (!jobDigest || !(await isActive(candidateId, jobDigest.profile.id))) return null;
          const head = `Job Digest (id ${jobDigest.id}) envoyé le ${day(jobDigest.sentAt)} pour le profil « ${jobDigest.profile.name} ».`;
          return { text: resultsText(head, jobDigest.results, maxTokens), pages: [routes.jobDigest(jobDigest.id)], untrusted: true };
        }
        case "tailored_documents": {
          const application = await sources.applications.get(candidateId, id);
          if (!application || !(await isActive(candidateId, application.profile.id))) return null;
          const [drafts, tailoredCv] = await Promise.all([sources.tailoredDocuments.get(candidateId, id), sources.tailoredCvs.get(candidateId, id)]);
          const text = [
            // No word of the Job Offer (its title neither): nothing here is text the Candidate did not write.
            `Documents adaptés de la candidature (id ${application.id}), profil « ${application.profile.name} ».`,
            tailoredCvLine(tailoredCv),
            draftLine("Lettre de motivation", "rédigée", "modifiée", "aucune", drafts?.coverLetter ?? null),
            draftLine("Message d'approche", "rédigé", "modifié", "aucun", drafts?.outreachMessage ?? null, drafts?.outreachMessage ? ` par ${OUTREACH_CHANNEL[drafts.outreachMessage.channel]}` : ""),
          ].join("\n");
          return { text: fitted([text], maxTokens), pages: [routes.applicationSection(application.id, "documents")], untrusted: false };
        }
        default:
          return null;
      }
    },
  };
}
