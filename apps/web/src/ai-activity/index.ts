/**
 * AI Activity's page loaders (CONTEXT.md, ADR-0034, #332): the elements of a Candidate page that AI may have produced,
 * each read from its stored Provenance, one loader per page type; the « Cette page » pane sums them (pane.ts).
 *
 *   await jobOfferPage(sources, candidateId, jobOffer)                 `/offres/[id]`
 *   await jobSearchPage(sources, searches)                             `/recherches` and `/recherches/[id]`
 *   await jobDigestPage(sources, jobDigest)                            `/job-digests/[id]`
 *   await applicationPage(sources, candidateId, application, made)     `/candidatures/[id]/*`
 *   await profilePage(sources, candidateId, profile, made)             `/profils/[id]/*`
 *
 * What counts is the page's content whatever its date, and the AI Coach replies whose focus is the page's object, from
 * any conversation. Other content the page shows is `made`, with its Provenance when its slice keeps one (an Action
 * Card, an ATS Score, #336; a Tailored CV or Document, #334: `tailoredDocumentsMade`); without one (content made
 * before) it is listed as « modèle non enregistré », out of every total. Only what the pane shows crosses to the browser (pane.ts): never
 * an internal id, cost, prompt, AI task, Playbook Agent, Outcome or technical error.
 */
import type { Provenance, ProvenanceSite } from "@jobhub/shared";
import type { CoachConversations } from "../coach-conversations";
import type { JobOffers } from "../job-offers";
import { activityElement, type ActivityElement, type ElementKind } from "./pane";

export { activityElement, aiActivityPane, byRulesOnly, ELEMENT_KINDS, type ActivityElement, type ActivityModel, type ActivityTool, type AiActivityPane, type ElementKind } from "./pane";

/** Where the pages' Provenance is read: the Job Offers', and the AI Coach replies' about a page's object. */
export interface PageSources {
  jobOffers: Pick<JobOffers, "provenances">;
  coachReplies: Pick<CoachConversations, "repliesAbout">;
}

/** A Job Offer a page shows: its title names it in the pane, its id only finds its Provenance. */
export type OfferShown = { id: string; title: string };

/**
 * Content a page shows, with what made it: its Provenance, else « modèle non enregistré », dated when it was made, if
 * known. `name`: an Action Card's title. `sites`: without a Provenance, the sites it is known to be built from (a
 * Company Dossier built before, from its own source, #335).
 */
export type Made = { kind: ElementKind; at?: Date | null; name?: string; provenance?: Provenance | null; sites?: readonly ProvenanceSite[] };

async function offers(sources: PageSources, shown: readonly OfferShown[]): Promise<ActivityElement[]> {
  const provenances = await sources.jobOffers.provenances(shown.map((offer) => offer.id));
  return shown.map((offer) => activityElement("job_offer", provenances.get(offer.id) ?? null, { name: offer.title }));
}

async function repliesAbout(sources: PageSources, candidateId: string, focus: Parameters<CoachConversations["repliesAbout"]>[1]): Promise<ActivityElement[]> {
  const replies = await sources.coachReplies.repliesAbout(candidateId, focus);
  return replies.map((reply) => activityElement("coach_reply", reply.provenance, { at: reply.at }));
}

const made = (content: readonly Made[]): ActivityElement[] =>
  content.map(({ kind, at, name, provenance, sites }) => activityElement(kind, provenance ?? null, { ...(name ? { name } : {}), at: at ? at.toISOString() : null, ...(sites ? { sites } : {}) }));

/** `/offres/[id]`: the Job Offer, how it was found, read and summarized, and the Coach replies about it. */
export async function jobOfferPage(sources: PageSources, candidateId: string, jobOffer: OfferShown): Promise<ActivityElement[]> {
  const [offer, replies] = await Promise.all([offers(sources, [jobOffer]), repliesAbout(sources, candidateId, { kind: "job_offer", id: jobOffer.id })]);
  return [...offer, ...replies];
}

/** `/recherches` and `/recherches/[id]`: each Job Search shown with its run's Provenance (null until kept), then the Job Offers it found. */
export async function jobSearchPage(
  sources: PageSources,
  searches: readonly { startedAt: Date; provenance?: Provenance | null; results: readonly { jobOffer: OfferShown }[] }[],
): Promise<ActivityElement[]> {
  const found = await offers(
    sources,
    searches.flatMap((search) => search.results.map((result) => result.jobOffer)),
  );
  let next = 0;
  return searches.flatMap((search) => [
    activityElement("job_search", search.provenance ?? null, { at: search.startedAt.toISOString() }),
    ...found.slice(next, (next += search.results.length)),
  ]);
}

/** `/job-digests/[id]`: the Job Digest (its Match Scores and top-up run, once kept), then the Job Offers it brought. */
export async function jobDigestPage(
  sources: PageSources,
  jobDigest: { sentAt: Date; provenance?: Provenance | null; results: readonly { jobOffer: OfferShown }[] },
): Promise<ActivityElement[]> {
  return [
    ...made([{ kind: "job_digest", at: jobDigest.sentAt, provenance: jobDigest.provenance }]),
    ...(await offers(sources, jobDigest.results.map((result) => result.jobOffer))),
  ];
}

/** `/candidatures/[id]/*`, every Section: the Job Offer, what was made for the Application, and the Coach replies about it. */
export async function applicationPage(sources: PageSources, candidateId: string, application: { id: string; jobOffer: OfferShown }, content: readonly Made[]): Promise<ActivityElement[]> {
  const [offer, replies] = await Promise.all([offers(sources, [application.jobOffer]), repliesAbout(sources, candidateId, { kind: "application", id: application.id })]);
  return [...offer, ...made(content), ...replies];
}

/** `/profils/[id]/*`, every Section: what was made for the Profile, and the Coach replies about it. */
export async function profilePage(sources: PageSources, candidateId: string, profile: { id: string }, content: readonly Made[]): Promise<ActivityElement[]> {
  return [...made(content), ...(await repliesAbout(sources, candidateId, { kind: "profile", id: profile.id }))];
}

/** A Tailored Document as AI Activity reads it: its Provenance, once kept. */
type Written = { provenance: Provenance | null };

/**
 * The Application's Tailored Documents written so far (#334), as `made` for `applicationPage`, each with its Provenance
 * and when it was written: the saved Tailored CV and the proposal under review (both « tailored_cv »), the Cover Letter
 * and the Outreach Message (both « tailored_documents »). `/candidatures/[id]/documents` shows them; every Section lists them.
 */
export function tailoredDocumentsMade(
  tailoredCv: { saved: (Written & { savedAt: Date }) | null; proposal: (Written & { proposedAt: Date }) | null } | null,
  drafts: { coverLetter: (Written & { draftedAt: Date }) | null; outreachMessage: (Written & { draftedAt: Date }) | null } | null,
): Made[] {
  const documents: [ElementKind, Written | null | undefined, Date | undefined][] = [
    ["tailored_cv", tailoredCv?.saved, tailoredCv?.saved?.savedAt],
    ["tailored_cv", tailoredCv?.proposal, tailoredCv?.proposal?.proposedAt],
    ["tailored_documents", drafts?.coverLetter, drafts?.coverLetter?.draftedAt],
    ["tailored_documents", drafts?.outreachMessage, drafts?.outreachMessage?.draftedAt],
  ];
  return documents.flatMap(([kind, document, at]) => (document ? [{ kind, at: at ?? null, provenance: document.provenance }] : []));
}
