/**
 * The Candidate's reads over HTTP (ADR-0076, #684): what the GETs of the `/api/*` routes answer the Jobbbox app, the
 * menus' cards and the objects they lead to, each in its type from `@jobhub/shared/reads`.
 *
 * One deep module in front of the modules the pages already read: `createCandidateReads(deps)` gives one read per
 * GET, each calling the same module functions, and the same pure menus (applicationsMenu, jobSearchesMenu,
 * jobDigestsMenu), as the page it mirrors, then writing the answer as JSON: instants as ISO strings, absent values as
 * null. No query of its own: a rule a page applies (an Archived Profile left out of a card, the Match Score shown only
 * when computable) is the module's or the menu's, so the page and the app cannot disagree.
 *
 * Every read is scoped to the Candidate, as the modules are: one that names another Candidate's object gives null,
 * which the route answers 404. A session pending its second step never reaches it: the proxy answers it 401
 * `second_step_required` (ADR-0075), and getCurrentCandidate gives no Candidate for it.
 */
import { matchScoreReliability, type MatchScore } from "@jobhub/shared";
import type {
  AgendaItemRead,
  AgendaResponse,
  ApplicationResponse,
  ApplicationsResponse,
  CoachConversationRead,
  CoachConversationResponse,
  CoachConversationsResponse,
  CoachingOrderResponse,
  CoachingResponse,
  InterviewRead,
  JobDigestsResponse,
  JobOfferLine,
  JobSearchesResponse,
  JobSearchResponse,
  OfferBoxResponse,
  ProfileResponse,
  ProfilesResponse,
  RescheduleRead,
  TailoredDocumentsResponse,
} from "@jobhub/shared/reads";
import { CV_TEMPLATES, EXPORT_FORMATS, type ExportFormat } from "../export/kinds";
import type { Agenda, AgendaItem } from "../agenda";
import type { Applications, Interview } from "../applications";
import type { ApplicationExportKind } from "../application-exports/kinds";
import type { AtsScoring } from "../ats-score";
import type { Billing } from "../billing";
import type { CoachConversation, CoachConversations, CoachConversationSummary } from "../coach-conversations";
import { applicationsMenu } from "../applications/menu";
import type { FollowUps } from "../follow-ups";
import type { HumanCoaches } from "../human-coaches";
import type { JobDigests } from "../job-digests";
import { jobDigestsMenu } from "../job-digests/menu";
import type { JobSearches } from "../job-searches";
import type { Orders } from "../orders";
import type { Withdrawals } from "../withdrawals";
import { jobSearchesMenu } from "../job-searches/menu";
import type { OfferBox, OfferBoxContents } from "../offer-box";
import type { Profiles } from "../profiles";
import type { Reschedule } from "../reschedules";
import type { TailoredCvs } from "../tailored-cv";
import type { TailoredDocuments } from "../tailored-documents";

export interface CandidateReads {
  /** Mes candidatures' card, latest saved first; the Archived Applications only when `showArchived`. */
  applications(candidateId: string, options?: { showArchived?: boolean }): Promise<ApplicationsResponse>;
  /** One of the Candidate's Applications with its Interviews; null when it is not theirs. */
  application(candidateId: string, applicationId: string): Promise<ApplicationResponse | null>;
  /** Recherches d'offres' card: each active Profile, in their order, with its Job Searches, most recent first. */
  jobSearches(candidateId: string): Promise<JobSearchesResponse>;
  /** The Offer box (« Offres à traiter », ADR-0090): every entry, the most recent first Arrival first, and how many are à traiter. */
  offerBox(candidateId: string): Promise<OfferBoxResponse>;
  /** One of the Candidate's Job Searches and its Job Offers, best Match Score first; null when it is not theirs. */
  jobSearch(candidateId: string, jobSearchId: string): Promise<JobSearchResponse | null>;
  /** The Job Digests' card: each active Profile, its Job Digest's frequency and those sent, newest first. */
  jobDigests(candidateId: string): Promise<JobDigestsResponse>;
  /** The Agenda as a list: « À planifier », then the Agenda Items by day, upcoming (or the past ones, when `past`). */
  agenda(candidateId: string, options?: { past?: boolean }): Promise<AgendaResponse>;
  /** Mes coachs humains: the Human Coaches, the Candidate's Coaching Sessions and what one costs them. */
  coaching(candidateId: string): Promise<CoachingResponse>;
  /** The Order page of a Coaching Session with `coachId`, as the app shows it before Checkout (#694); null when they cannot be booked. */
  coachingOrder(candidateId: string, coachId: string): Promise<CoachingOrderResponse | null>;
  /** The Candidate's active Profiles, oldest first: an Archived Profile left out. */
  profiles(candidateId: string): Promise<ProfilesResponse>;
  /** One of the Candidate's Profiles to read, an archived one included; null when it is not theirs. */
  profile(candidateId: string, profileId: string): Promise<ProfileResponse | null>;
  /** The Tailored Documents of one of the Candidate's Applications, with their download links; null when it is not theirs. */
  tailoredDocuments(candidateId: string, applicationId: string): Promise<TailoredDocumentsResponse | null>;
  /** The Candidate's Coach Conversations, most recently active first; the Free conversations alone when `free`. */
  coachConversations(candidateId: string, options?: { free?: boolean }): Promise<CoachConversationsResponse>;
  /**
   * The conversation of a Subject (`subject`: untrusted, { kind, id }) with its messages, null until its first message;
   * `invalid` for a Subject that names nothing, `not_found` for an object that is not the Candidate's.
   */
  coachConversationOfSubject(candidateId: string, subject: unknown): Promise<CoachConversationResponse | { error: "invalid" | "not_found" }>;
  /** One of the Candidate's Coach Conversations with its messages; null when it is not theirs. */
  coachConversation(candidateId: string, conversationId: string): Promise<CoachConversationResponse | null>;
}

export interface CandidateReadsDeps {
  applications: Pick<Applications, "list" | "get" | "matchScores">;
  followUps: Pick<FollowUps, "notices">;
  profiles: Pick<Profiles, "list" | "get">;
  jobSearches: Pick<JobSearches, "list" | "get">;
  jobDigests: Pick<JobDigests, "list" | "settings">;
  agenda: Pick<Agenda, "days" | "unscheduled">;
  humanCoaches: Pick<HumanCoaches, "list" | "accessGranted" | "sessions">;
  billing: Pick<Billing, "coachingSessionPrice">;
  /** Which Coaching Sessions « Renoncer au contrat ici » still leads from (#511). */
  withdrawals: Pick<Withdrawals, "contracts">;
  orders: Pick<Orders, "terms">;
  atsScoring: Pick<AtsScoring, "latest">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  coachConversations: Pick<CoachConversations, "list" | "ofSubject" | "open">;
  offerBox: OfferBox;
  /** The clock « from now on » is read by (an Application's next deadline, the Agenda's today). Defaults to the real time. */
  now?: () => Date;
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** A Match Score's figure, null when it is not computable, as the cards show it. */
const figure = (score: MatchScore | undefined): number | null => (score && matchScoreReliability(score) !== "not_computable" ? score.score : null);

const reschedule = ({ previousAt, newAt, by, at }: Reschedule): RescheduleRead => ({ previousAt: iso(previousAt), newAt: isoOrNull(newAt), by, at: iso(at) });

const interview = (held: Interview): InterviewRead => ({
  id: held.id,
  scheduledAt: iso(held.scheduledAt),
  durationMinutes: held.durationMinutes,
  format: held.format,
  place: held.place,
  note: held.note,
  cancelledAt: isoOrNull(held.cancelledAt),
  reschedules: held.reschedules.map(reschedule),
});

/** The next Interview of an Application not cancelled, from `now` on: its next deadline. */
function nextDeadline(interviews: readonly Interview[], now: Date): string | null {
  const next = interviews.filter((held) => !held.cancelledAt && held.scheduledAt.getTime() >= now.getTime()).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  return next ? iso(next.scheduledAt) : null;
}

const agendaItem = (item: AgendaItem): AgendaItemRead =>
  item.kind === "interview"
    ? {
        kind: "interview",
        id: item.id,
        applicationId: item.applicationId,
        jobTitle: item.jobTitle,
        employer: item.employer ?? null,
        scheduledAt: iso(item.scheduledAt),
        durationMinutes: item.durationMinutes,
        format: item.format,
        place: item.place,
        note: item.note ?? null,
        cancelledAt: isoOrNull(item.cancelledAt),
        reschedules: item.reschedules.map(reschedule),
      }
    : {
        kind: "coachingSession",
        id: item.id,
        coach: { id: item.coach.id, name: item.coach.name },
        scheduledAt: iso(item.scheduledAt),
        durationMinutes: item.durationMinutes ?? null,
        videoLink: item.videoLink ?? null,
        note: item.note ?? null,
        changedBy: item.changedBy,
        reschedules: item.reschedules.map(reschedule),
      };

const conversationSummary = (conversation: CoachConversationSummary): CoachConversationsResponse["conversations"][number] => ({
  id: conversation.id,
  title: conversation.title,
  subject: conversation.subject && { kind: conversation.subject.kind, id: conversation.subject.id, name: conversation.subject.name },
  profile: conversation.profile && { id: conversation.profile.id, name: conversation.profile.name },
  lastMessageAt: iso(conversation.lastMessageAt),
});

const conversationRead = (conversation: CoachConversation): CoachConversationRead => ({
  ...conversationSummary(conversation),
  aiDisclosure: conversation.aiDisclosure,
  messages: conversation.messages.map((message) => ({
    from: message.from,
    text: message.text,
    ...(message.provenance !== undefined && { provenance: message.provenance }),
    ...(message.at !== undefined && { at: message.at }),
    ...(message.blocked && { blocked: message.blocked }),
    ...(message.jobOffer && { jobOffer: message.jobOffer }),
    ...(message.cards && { cards: message.cards }),
    ...(message.seenNames && { seenNames: message.seenNames }),
  })),
  context: {
    messages: conversation.context.messages,
    tokens: conversation.context.tokens,
    ...(conversation.context.limits !== undefined && { limits: conversation.context.limits }),
    ...(conversation.context.split !== undefined && { split: conversation.context.split }),
    ...(conversation.context.upgrade !== undefined && { upgrade: conversation.context.upgrade }),
  },
});

/** Where a Tailored Document is downloaded, as its Section offers it: with the first CV Template. */
const EXPORT_PATHS: Record<ApplicationExportKind, string> = { tailored_cv: "tailored-cv", cover_letter: "cover-letter" };
const downloads = (applicationId: string, document: ApplicationExportKind): Record<ExportFormat, string> => {
  const path = `/api/applications/${encodeURIComponent(applicationId)}/${EXPORT_PATHS[document]}/export`;
  const at = (format: ExportFormat) => `${path}?${new URLSearchParams({ format, template: CV_TEMPLATES[0] })}`;
  return Object.fromEntries(EXPORT_FORMATS.map((format) => [format, at(format)])) as Record<ExportFormat, string>;
};

type JobOfferFacts = { id: string; title: string; employer?: string; location?: string; source?: { url?: string }; postedAt?: Date; expiredAt?: Date };

const jobOfferLine = (offer: JobOfferFacts): JobOfferLine => ({
  id: offer.id,
  title: offer.title,
  employer: offer.employer ?? null,
  location: offer.location ?? null,
  url: offer.source?.url ?? null,
  postedAt: isoOrNull(offer.postedAt),
  expiredAt: isoOrNull(offer.expiredAt),
});

/** The Offer box as `GET /api/offer-box` answers it, and as the web page reads it too (ADR-0090): the two cannot drift apart. */
export function offerBoxResponse(box: OfferBoxContents): OfferBoxResponse {
  return {
    today: box.today,
    toHandle: box.toHandle,
    entries: box.entries.map((entry) => ({
      id: entry.id,
      jobOffer: { ...jobOfferLine(entry.jobOffer), contractType: entry.jobOffer.contractType ?? null },
      profile: entry.profile,
      scoredWith: entry.scoredWith,
      matchScore: entry.matchScore ? figure(entry.matchScore) : null,
      firstArrivalAt: iso(entry.firstArrivalAt),
      arrivalDay: entry.arrivalDay,
      sources: entry.sources.map(({ source, at }) => ({ source, at: iso(at) })),
      state: entry.state,
      applicationId: entry.applicationId,
      followedAt: isoOrNull(entry.followedAt),
    })),
  };
}

/** The menus' cards name no day: the app writes it in the Candidate's language from the instant. */
const NO_DAY_LABEL = () => "";

export function createCandidateReads(deps: CandidateReadsDeps): CandidateReads {
  const now = deps.now ?? (() => new Date());

  /** The Candidate's active Profiles, in their order: the cards leave an Archived Profile out. */
  async function activeProfiles(candidateId: string) {
    return (await deps.profiles.list(candidateId)).filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  }

  return {
    async applications(candidateId, { showArchived = false } = {}) {
      const [listed, notices, matchScores] = await Promise.all([
        deps.applications.list(candidateId),
        deps.followUps.notices(candidateId),
        deps.applications.matchScores(candidateId),
      ]);
      const menu = applicationsMenu({ applications: listed, notices, matchScores, showArchived });
      const byId = new Map(listed.map((application) => [application.id, application]));
      const today = now();
      return {
        applications: menu.rows.map((row) => {
          const application = byId.get(row.id)!;
          return {
            id: row.id,
            title: row.title,
            employer: row.employer,
            status: row.status,
            matchScore: row.matchScore,
            toHandle: row.toHandle,
            nextDeadline: nextDeadline(application.interviews, today),
            expired: row.expired,
            reportedByYou: row.reportedByYou,
            archived: application.profile.archived,
          };
        }),
        toHandle: menu.toHandle,
        archivedHidden: menu.archivedHidden,
      };
    },

    async application(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      return {
        id: application.id,
        status: application.status,
        statusChangedAt: iso(application.statusChangedAt),
        createdAt: iso(application.createdAt),
        jobOffer: jobOfferLine(application.jobOffer),
        profile: { id: application.profile.id, name: application.profile.name },
        matchScore: figure(application.matchScore),
        reportedUnavailableAt: isoOrNull(application.reportedUnavailableAt),
        interviews: application.interviews.map(interview),
      };
    },

    async jobSearches(candidateId) {
      const [profiles, searches] = await Promise.all([activeProfiles(candidateId), deps.jobSearches.list(candidateId)]);
      const menu = jobSearchesMenu({ profiles, searches, dateLabel: NO_DAY_LABEL });
      return {
        profiles: menu.groups.map(({ profile, searches: ofProfile }) => ({
          profile,
          searches: ofProfile.map((search) => ({ id: search.id, status: search.status, startedAt: iso(search.startedAt), found: search.found, unseen: search.unseen })),
        })),
        unseen: menu.unseen,
      };
    },

    async offerBox(candidateId) {
      return offerBoxResponse(await deps.offerBox.read(candidateId));
    },

    async jobSearch(candidateId, jobSearchId) {
      const search = await deps.jobSearches.get(candidateId, jobSearchId);
      if (!search) return null;
      return {
        id: search.id,
        profile: { id: search.profile.id, name: search.profile.name },
        status: search.status,
        failure: search.failure,
        startedAt: iso(search.startedAt),
        jobOffers: search.results.map((result) => ({
          jobOffer: jobOfferLine(result.jobOffer),
          matchScore: figure(result.matchScore),
          // Kept: saved as an Application. Dismissing comes with the app's « Écarter » (#692).
          decision: result.applicationId ? ("kept" as const) : null,
          applicationId: result.applicationId,
        })),
      };
    },

    async jobDigests(candidateId) {
      const [profiles, digests] = await Promise.all([activeProfiles(candidateId), deps.jobDigests.list(candidateId)]);
      const settings = new Map(await Promise.all(profiles.map(async (profile) => [profile.id, await deps.jobDigests.settings(candidateId, profile.id)] as const)));
      const menu = jobDigestsMenu({ profiles, digests, dateLabel: NO_DAY_LABEL });
      return {
        profiles: menu.groups.map(({ profile, digests: sent }) => {
          const jobDigest = settings.get(profile.id);
          return {
            profile,
            frequency: jobDigest?.frequency ?? "none",
            chosenFrequency: jobDigest?.chosenFrequency ?? null,
            planFrequency: jobDigest?.planFrequency ?? "none",
            digests: sent.map((digest) => ({ id: digest.id, sentAt: iso(digest.sentAt), count: digest.count })),
          };
        }),
      };
    },

    async agenda(candidateId, { past = false } = {}) {
      const [unscheduled, days] = await Promise.all([deps.agenda.unscheduled(candidateId), deps.agenda.days(candidateId, { period: past ? "past" : "upcoming", now: now() })]);
      return {
        toSchedule: unscheduled.map((session) => ({
          id: session.id,
          coach: { id: session.coach.id, name: session.coach.name, bookingUrl: session.coach.bookingUrl },
          paidAt: iso(session.paidAt),
          reschedules: session.reschedules.map(reschedule),
        })),
        days: days.map(({ day, items }) => ({ day, items: items.map(agendaItem) })),
      };
    },

    async coaching(candidateId) {
      const [coaches, granted, sessions, contracts, price] = await Promise.all([
        deps.humanCoaches.list(),
        deps.humanCoaches.accessGranted(candidateId),
        deps.humanCoaches.sessions(candidateId),
        deps.withdrawals.contracts(candidateId),
        deps.billing.coachingSessionPrice(candidateId).catch((cause: unknown) => {
          // As the page: a price that cannot be read (Stripe unreachable) books nothing, the rest is still shown.
          console.error("[coaching] Coaching Session Price unavailable", cause);
          return null;
        }),
      ]);
      // As the Agenda: the sessions still in their Withdrawal period, and not held under the Immediate Performance Request.
      const withdrawable = new Set(contracts.flatMap((contract) => (contract.kind === "coachingSession" ? [contract.sessionId] : [])));
      return {
        // A Human Coach's email is theirs to sign in with: never shown to a Candidate.
        coaches: coaches.map((coach) => ({ id: coach.id, name: coach.name, bio: coach.bio, accessGranted: granted.includes(coach.id) })),
        sessions: sessions.map((session) => ({
          id: session.id,
          coach: { id: session.coach.id, name: session.coach.name, bookingUrl: session.coach.bookingUrl },
          paidAt: iso(session.paidAt),
          scheduledAt: isoOrNull(session.scheduledAt),
          durationMinutes: session.durationMinutes,
          videoLink: session.videoLink,
          note: session.note,
          changedBy: session.changedBy,
          reschedules: session.reschedules.map(reschedule),
          withdrawable: withdrawable.has(session.id),
        })),
        price: price && { amount: price.amount, regularAmount: price.regularAmount, currency: price.currency },
      };
    },

    async coachingOrder(candidateId, coachId) {
      const terms = await deps.orders.terms(candidateId, { kind: "coachingSession", coachId });
      if (!terms) return null;
      const { summary, cgv } = terms;
      return {
        coach: { id: coachId, name: summary.subject.fr },
        price: summary.price && { amount: summary.price.amount, currency: summary.price.currency },
        cgv: cgv && { version: cgv.version, url: cgv.url },
      };
    },

    async profiles(candidateId) {
      return activeProfiles(candidateId);
    },

    async profile(candidateId, profileId) {
      const profile = await deps.profiles.get(candidateId, profileId);
      if (!profile) return null;
      const atsScore = await deps.atsScoring.latest(candidateId, profile.id);
      return {
        id: profile.id,
        name: profile.name,
        archived: profile.archived,
        searchCriteria: profile.searchCriteria,
        masterCv: { version: profile.masterCv.version, content: profile.masterCv.content },
        atsScore: atsScore?.score.score ?? null,
      };
    },

    async tailoredDocuments(candidateId, applicationId) {
      const [tailoredCv, drafts] = await Promise.all([deps.tailoredCvs.get(candidateId, applicationId), deps.tailoredDocuments.get(candidateId, applicationId)]);
      if (!tailoredCv || !drafts) return null;
      const { saved } = tailoredCv;
      const { coverLetter, outreachMessage } = drafts;
      return {
        documentLanguage: drafts.documentLanguage,
        // Only what the Candidate has: the saved Tailored CV (never a proposal under review), the drafts written.
        documents: [
          ...(saved ? [{ kind: "tailored_cv" as const, language: saved.language, updatedAt: iso(saved.savedAt), downloads: downloads(applicationId, "tailored_cv"), message: null }] : []),
          ...(coverLetter
            ? [{ kind: "cover_letter" as const, language: coverLetter.language, updatedAt: iso(coverLetter.updatedAt), downloads: downloads(applicationId, "cover_letter"), message: null }]
            : []),
          ...(outreachMessage
            ? [
                {
                  kind: "outreach_message" as const,
                  language: outreachMessage.language,
                  updatedAt: iso(outreachMessage.updatedAt),
                  downloads: null,
                  message: { subject: outreachMessage.subject, text: outreachMessage.text },
                },
              ]
            : []),
        ],
      };
    },

    async coachConversations(candidateId, { free = false } = {}) {
      const listed = await deps.coachConversations.list(candidateId);
      return { conversations: listed.filter((conversation) => !free || conversation.subject === null).map(conversationSummary) };
    },

    async coachConversationOfSubject(candidateId, subject) {
      const result = await deps.coachConversations.ofSubject(candidateId, subject);
      if (!result.ok) return { error: result.error };
      return { conversation: result.conversation && conversationRead(result.conversation) };
    },

    async coachConversation(candidateId, conversationId) {
      const conversation = await deps.coachConversations.open(candidateId, conversationId);
      return conversation && { conversation: conversationRead(conversation) };
    },
  };
}
