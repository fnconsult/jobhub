/**
 * AI Activity's page loaders (CONTEXT.md, ADR-0034, #332, ADR-0086): what a Candidate page's Activity is built from, its
 * PageActivity: the elements AI may have produced, each with its stored Provenance, its name and its page, the AI Coach
 * replies about its object and, on a Profile's page, its Master CV Versions; one loader per page type. The browser builds
 * the Activité entries from it (entries.ts, #807, #808).
 *
 *   await jobOfferPage(sources, candidateId, jobOffer)                 `/offres/[id]`
 *   await jobSearchPage(sources, searches, about?)                     `/recherches/[id]` (`about`: its Job Search)
 *   await jobDigestPage(sources, candidateId, jobDigest)               `/job-digests/[id]`
 *   await agendaPage(sources, candidateId)                             `/agenda`
 *   await applicationPage(sources, candidateId, application, made)     `/candidatures/[id]/*`
 *   await profilePage(sources, candidateId, profile, made)             `/profils/[id]/*`
 *
 * What counts is the page's content whatever its date, and the AI Coach replies whose focus is the page's object, from
 * any conversation. Other content the page shows is `made`, with its Provenance when its slice keeps one (an Action
 * Card, an ATS Score, #336; a Tailored CV or Document, #334: `tailoredDocumentsMade`); without one (content made
 * before) it is listed as « modèle non enregistré », out of every total. Never a cost, prompt, AI task, Playbook Agent,
 * Outcome or technical error crosses to the browser; ids only in the pages' addresses (and a version's Origin, its card).
 */
import type { Provenance, ProvenanceSite } from "@jobhub/shared";
import type { CoachConversations } from "../coach-conversations";
import type { JobOffers } from "../job-offers";
import type { JobSearchFailure, JobSearchStatus } from "../job-searches";
import { routes } from "../routes";
import type { PageElement, PageScope, ReplyGiven, VersionGiven } from "./entries";
import { activityElement, type ActionEnded, type ActivityElement, type ElementKind } from "./pane";

const withEnded = (ended: ActionEnded | undefined) => (ended ? { ended } : {});

export { activityElement, aiActivityPane, byRulesOnly, ELEMENT_KINDS, type ActionEnded, type ActivityElement, type ElementEnd, type ActivityModel, type ActivityTool, type AiActivityPane, type ElementKind } from "./pane";

/**
 * What a page's Activity is built from (ADR-0086, #808), on the server: which page it is, the content it shows that AI
 * may have produced (`elements`, with its Provenance, its name and its page), the AI Coach replies about its object from
 * any conversation (`replies`), and on a Profile's page its Master CV Versions. The server builds its entries from it
 * (`servedEntries`, server.ts), which alone cross to the browser; the browser adds the replies its thread shows.
 */
export interface PageActivity {
  page: PageScope;
  elements: PageElement[];
  replies: ReplyGiven[];
  versions?: VersionGiven[];
}

/**
 * The page's elements as the former « Cette page » pane read them (pane.ts): its content, its Master CV read from a file,
 * then the replies; what the closed AI Activity button sums.
 */
export function paneElements(activity: PageActivity): ActivityElement[] {
  const read = (activity.versions ?? []).filter((version) => version.provenance);
  return [
    ...activity.elements.map((element) =>
      activityElement(element.kind, element.provenance, {
        ...(element.name ? { name: element.name } : {}),
        at: element.at == null ? null : typeof element.at === "string" ? element.at : element.at.toISOString(),
        ...(element.sites ? { sites: element.sites } : {}),
        ...withEnded(element.ended),
      }),
    ),
    ...read.map((version) => activityElement("master_cv", version.provenance ?? null, { at: new Date(version.savedAt).toISOString() })),
    ...activity.replies.map((reply) => activityElement("coach_reply", reply.provenance, { at: new Date(reply.at).toISOString(), sent: reply.sent })),
  ];
}

/** Where the pages' Provenance is read: the Job Offers', and the AI Coach replies' about a page's object. */
export interface PageSources {
  jobOffers: Pick<JobOffers, "provenances">;
  coachReplies: Pick<CoachConversations, "repliesAbout">;
}

/** A Job Offer a page shows: its title names it, its id finds its Provenance and its page. */
export type OfferShown = { id: string; title: string };

/**
 * Content a page shows, with what made it: its Provenance, else « modèle non enregistré », dated when it was made, if
 * known. `name`: an Action Card's title. `sites`: without a Provenance, the sites it is known to be built from (a
 * Company Dossier built before, from its own source, #335). `href`: its page. `scored`: an ATS Score's Master CV Version.
 * `result`: what it gave, as the page knows it.
 */
export type Made = {
  kind: ElementKind;
  at?: Date | null;
  name?: string;
  provenance?: Provenance | null;
  sites?: readonly ProvenanceSite[];
  href?: string;
  scored?: number;
  result?: PageElement["result"];
};

/** The Job Offers shown, each at `href(id)`, `after` the element that found them. */
async function offers(sources: PageSources, shown: readonly OfferShown[], href: (id: string) => string, after?: number): Promise<PageElement[]> {
  const provenances = await sources.jobOffers.provenances(shown.map((offer) => offer.id));
  return shown.map((offer) => ({ kind: "job_offer", provenance: provenances.get(offer.id) ?? null, name: offer.title, href: href(offer.id), ...(after === undefined ? {} : { after }) }));
}

const offerPage = (id: string) => routes.jobOffer(id);

async function repliesAbout(sources: PageSources, candidateId: string, focus: Parameters<CoachConversations["repliesAbout"]>[1]): Promise<ReplyGiven[]> {
  const replies = await sources.coachReplies.repliesAbout(candidateId, focus);
  // A reply's message is known by when it was saved, as the thread shows it.
  return replies.map((reply) => ({ messageId: reply.at, at: reply.at, question: reply.question ?? null, provenance: reply.provenance, sent: reply.sent }));
}

const made = (content: readonly Made[]): PageElement[] =>
  content.map(({ kind, at, name, provenance, sites, href, scored, result }) => ({
    kind,
    provenance: provenance ?? null,
    at: at ? at.toISOString() : null,
    ...(name ? { name } : {}),
    ...(sites ? { sites } : {}),
    ...(href ? { href } : {}),
    ...(scored === undefined ? {} : { scored }),
    ...(result ? { result } : {}),
  }));

/** `/offres/[id]`: the Job Offer, how it was found, read and summarized, and the Coach replies about it. */
export async function jobOfferPage(sources: PageSources, candidateId: string, jobOffer: OfferShown): Promise<PageActivity> {
  const [offer, replies] = await Promise.all([offers(sources, [jobOffer], offerPage), repliesAbout(sources, candidateId, { kind: "job_offer", id: jobOffer.id })]);
  return { page: "any", elements: offer, replies };
}

/** How a Job Search shown ended, as its row says (#331): `failure` is why one failed. */
type SearchEnd = { status?: JobSearchStatus; failure?: JobSearchFailure | null };

/** A stopped or failed Job Search's end, with a failed one's Failure Reason as the Job Search page words it (#368). */
const searchEnded = ({ status, failure }: SearchEnd): ActionEnded | undefined =>
  status === "stopped" ? { state: "stopped" } : status === "failed" ? { state: "failed", reason: `jobSearch.failureReasons.${failure ?? "other"}` } : undefined;

/**
 * `/recherches/[id]`: each Job Search shown with its run's Provenance (null until kept), how it ended (a stopped or failed
 * one keeps its Job Offers, #331) and how many it kept, then the Job Offers it found, each « suite de » it; `about` its
 * Job Search, then the Coach replies about it (#600).
 */
export async function jobSearchPage(
  sources: PageSources,
  searches: readonly (SearchEnd & { id?: string; startedAt: Date; provenance?: Provenance | null; results: readonly { jobOffer: OfferShown }[] })[],
  about?: { candidateId: string; jobSearchId: string },
): Promise<PageActivity> {
  const replies = about ? repliesAbout(sources, about.candidateId, { kind: "job_search", id: about.jobSearchId }) : Promise.resolve([]);
  const elements: PageElement[] = [];
  for (const search of searches) {
    const at = elements.length;
    elements.push({
      kind: "job_search",
      provenance: search.provenance ?? null,
      at: search.startedAt.toISOString(),
      ...(search.id ? { href: routes.jobSearch(search.id) } : {}),
      ...withEnded(searchEnded(search)),
      result: { offers: search.results.length },
    });
    const page = search.id ? (offer: string) => routes.jobSearchOffer(search.id!, offer) : offerPage;
    elements.push(...(await offers(sources, search.results.map((result) => result.jobOffer), page, at)));
  }
  return { page: "job_search", elements, replies: await replies };
}

/** `/job-digests/[id]`: the Job Digest (its Match Scores and top-up run, once kept), then the Job Offers it brought, and the Coach replies about it (#600). */
export async function jobDigestPage(
  sources: PageSources,
  candidateId: string,
  jobDigest: { id: string; sentAt: Date; provenance?: Provenance | null; results: readonly { jobOffer: OfferShown }[] },
): Promise<PageActivity> {
  const [found, replies] = await Promise.all([
    offers(sources, jobDigest.results.map((result) => result.jobOffer), offerPage, 0),
    repliesAbout(sources, candidateId, { kind: "job_digest", id: jobDigest.id }),
  ]);
  const digest = made([{ kind: "job_digest", at: jobDigest.sentAt, provenance: jobDigest.provenance ?? null, href: routes.jobDigest(jobDigest.id), result: { offers: jobDigest.results.length } }]);
  return { page: "any", elements: [...digest, ...found], replies };
}

/** `/agenda`: the Coach replies given with the Agenda In view (#600); the Agenda shows nothing else AI made. */
export async function agendaPage(sources: PageSources, candidateId: string): Promise<PageActivity> {
  return { page: "any", elements: [], replies: await repliesAbout(sources, candidateId, { kind: "agenda", id: "agenda" }) };
}

/** `/candidatures/[id]/*`, every Section: the Job Offer, what was made for the Application, and the Coach replies about it. */
export async function applicationPage(sources: PageSources, candidateId: string, application: { id: string; jobOffer: OfferShown }, content: readonly Made[]): Promise<PageActivity> {
  const [offer, replies] = await Promise.all([offers(sources, [application.jobOffer], offerPage), repliesAbout(sources, candidateId, { kind: "application", id: application.id })]);
  return { page: "any", elements: [...offer, ...made(content)], replies };
}

/**
 * `/profils/[id]/*`, every Section: what was made for the Profile (its ATS Score « suite de » the version it scored, its
 * Action Cards), its Master CV Versions (by hand, from a Coach proposal, read from a file), and the Coach replies about it.
 */
export async function profilePage(sources: PageSources, candidateId: string, profile: { id: string }, content: readonly Made[], versions: readonly VersionGiven[] = []): Promise<PageActivity> {
  return { page: "profile", elements: made(content), replies: await repliesAbout(sources, candidateId, { kind: "profile", id: profile.id }), versions: [...versions] };
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
