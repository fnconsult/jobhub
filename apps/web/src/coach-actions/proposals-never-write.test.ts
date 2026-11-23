/**
 * The invariant of ADR-0077: a Coach Action never writes. Every proposing Coach Action of the catalogue shipped, called
 * the way an AI Coach reply calls it (`forReply(...).runTool`, COACH_ACTIONS_ENABLED on), over the real domain modules on
 * Postgres, leaves every table of the database as it was, and the in-memory ones (Job Searches, Job Digests, Tailored
 * documents) never see a write. Only its card's « Appliquer », the Candidate's own click, writes (coach-proposals).
 * A new proposing Coach Action must be listed in CALLS below, so that it is held to it too.
 */
import { createSecretKey, randomBytes, randomUUID } from "node:crypto";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionCards, migrateActionCards, migrateActionCardsInThread } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCoachMemory, migrateCoachMemory } from "../coach-memory";
import { coachProposalHandlers, createCoachProposals } from "../coach-proposals";
import { migrateCoachConversations } from "../coach-conversations";
import { createFollowUps, migrateFollowUps } from "../follow-ups";
import { migrateJobDigests } from "../job-digests";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { migrateCompanyDossiers } from "../company-dossiers";
import { migrateEnrichedContacts } from "../enriched-contacts";
import { createExchanges, migrateExchanges, sealExchangeContent } from "../exchanges";
import { createAesGcmCipher } from "../provider-secrets/cipher";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { shippedCoachActions, type CoachActionDomain } from "./catalog";
import { createCoachActions, type CoachAction, type CoachActionsForReply } from "./index";
import type { CoachObjectReader } from "./reads";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP", "Consolidation"],
  languages: [],
};

/** The ids the arguments name, known once the fixtures exist. */
interface World {
  daf: string;
  consultant: string;
  archived: string;
  applicationId: string;
  /** An Application « Postulée », for a follow-up. */
  appliedId: string;
  interviewId: string;
  newOfferId: string;
}

/** Each proposing Coach Action's arguments, as a reply would send them: each must make a proposal. */
const CALLS: Record<string, (world: World) => Record<string, unknown>> = {
  propose_application: (w) => ({ jobOfferId: w.newOfferId, profileId: w.daf }),
  propose_application_status: (w) => ({ applicationId: w.applicationId, status: "rejected" }),
  propose_application_profile: (w) => ({ applicationId: w.applicationId, profileId: w.consultant }),
  propose_follow_up_sent: (w) => ({ applicationId: w.appliedId }),
  propose_interview: (w) => ({ applicationId: w.applicationId, scheduledAt: "2026-12-10T14:00" }),
  propose_interview_change: (w) => ({ applicationId: w.applicationId, interviewId: w.interviewId, place: "Visioconférence" }),
  propose_interview_cancel: (w) => ({ applicationId: w.applicationId, interviewId: w.interviewId }),
  propose_search_criteria: (w) => ({ profileId: w.daf, addLocations: ["Paris"], minSalary: 90000 }),
  propose_draft_text: (w) => ({ applicationId: w.applicationId, document: "cover_letter", text: "Madame, Monsieur, une lettre courte." }),
  propose_master_cv_changes: (w) => ({
    profileId: w.daf,
    changes: [
      { kind: "rephrase", section: "summary", text: "Vingt-cinq ans de pilotage financier dans l'industrie." },
      { kind: "highlight", section: "skills", item: "Consolidation" },
    ],
  }),
  propose_profile_archive: (w) => ({ profileId: w.consultant }),
  propose_profile_restore: (w) => ({ profileId: w.archived }),
  propose_coach_memory: () => ({ kind: "goal", text: "Un poste de DAF dans l'aéronautique." }),
  propose_job_search: (w) => ({ profileId: w.daf }),
  propose_job_search_stop: (w) => ({ profileId: w.consultant }),
  propose_job_digest_frequency: (w) => ({ profileId: w.daf, frequency: "weekly" }),
  propose_tailored_cv: (w) => ({ applicationId: w.applicationId }),
  propose_cover_letter: (w) => ({ applicationId: w.applicationId }),
  propose_outreach_message: (w) => ({ applicationId: w.applicationId }),
  propose_document_restore: (w) => ({ applicationId: w.applicationId, document: "cover_letter", version: 1 }),
      // A Company Dossier built, and one person found at its employer (ADR-0114).
      companyDossiers: {
        get: async () => ({
          status: "built",
          dossier: {
            source: "french_register",
            reliability: "official",
            employer: "Acme Industrie",
            builtAt: new Date("2026-11-02T09:00:00Z"),
            siren: "123456789",
            name: "ACME INDUSTRIE",
            financials: [],
            executiveRoles: [],
            suggestedContactRoles: ["hr_director"],
            news: [],
            newsSearched: true,
          },
        }),
        confirmEmployer: write() as never,
      },
      enrichedContacts: {
        get: async () => ({
          enabled: true,
          searchable: true,
          found: [{ id: "c-found", name: "Paul Martin", jobTitle: "DRH", source: { provider: "lusha", providerPersonId: "p1", foundAt: new Date("2026-11-02T09:00:00Z") } }],
          contacts: [],
        }),
        find: write() as never,
        reveal: write() as never,
        contact: async () => null,
      },
      enrichedContactQuota: async () => ({ used: 0, limit: 5, refusal: null }),
