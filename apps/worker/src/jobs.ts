import { createRunProgress, FUNNEL_MATCH_SCORE, noDiscoveryMetrics, scoreMatch, type CvContent, type DiscoveryMetrics, type ExternalApiLog, type SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import type { FollowUps } from "@jobhub/web/follow-ups";

import { REMINDER_HOUR, REMINDER_TIME_ZONE, type AppointmentReminders } from "@jobhub/web/appointment-reminders";
import { MESSAGE_LOG_RETENTION_DAYS, purgeExpiredAiUsage, RETENTION_MONTHS as AI_USAGE_RETENTION_MONTHS } from "@jobhub/web/ai-usage";
import { purgeExpiredBackOfficeAudit, RETENTION_YEARS as BACK_OFFICE_AUDIT_RETENTION_YEARS } from "@jobhub/web/back-office";
import { purgeStaleAssistantConversations, RETENTION_MONTHS as ASSISTANT_RETENTION_MONTHS } from "@jobhub/web/back-office-assistant";
import { purgeStaleCoachConversations, RETENTION_MONTHS } from "@jobhub/web/coach-conversations";
import { purgeExpiredGuardrailTriggers, TRIGGER_RETENTION_MONTHS as GUARDRAIL_TRIGGER_RETENTION_MONTHS } from "@jobhub/web/guardrails";
import { purgeUnansweredQuestions } from "@jobhub/web/unanswered-questions";
import { purgeSignalements, RETENTION_MONTHS as SIGNALEMENT_RETENTION_MONTHS } from "@jobhub/web/signalements";
import { DIGEST_HOUR, DIGEST_TIME_ZONE, type JobDigests } from "@jobhub/web/job-digests";
import { createSourceChecks, forgetExpiredGuestCaptures } from "@jobhub/web/job-offers";
import { JOB_DISCOVERY_QUEUE, type JobSearchReports } from "@jobhub/web/job-searches";
import { JobDiscoveryError, type DiscoveryReport, type JobDiscovery } from "./job-discovery";
import { createSourceRecheck } from "./source-recheck";
import type { JobDefinition } from "./job-runner";
import type { ReferenceData } from "@jobhub/web/reference-data";

/**
 * Queue name: search the web for Job Offers matching one Profile.
 * Data: { candidateId, profileId, jobSearchId? }; with a `jobSearchId` (a Job
 * Search the Candidate started), the outcome is reported to that Job Search, with
 * the run's Provenance (its Match Scores included), and each step of the run is
 * written on it as it starts and ends, for the page polling it (#330). While it runs,
 * the worker asks every STOP_CHECK_MS whether the Candidate stopped it (#331): the run
 * then stops and the Job Search is recorded stopped, with the Job Offers found until then.
 */
export const JOB_DISCOVERY = JOB_DISCOVERY_QUEUE;

/** How often a running Job Search is asked whether its Candidate stopped it. */
export const STOP_CHECK_MS = 1000;

/** Queue name: fail the Job Searches the worker never answered, giving their Plan Quota use back. */
export const JOB_SEARCH_TIMEOUTS = "job-searches.expire";

/** Queue name: propose the Follow-ups (and "Abandonnée" suggestions) now due, and tell each Candidate. */
export const FOLLOW_UPS = "follow-ups.propose";

/**
 * Queue name, run every day at 07:00 Europe/Paris: queues a JOB_DIGEST_RUN for
 * each Profile whose Job Digest is due (daily ones every day, weekly ones on Monday).
 */
export const JOB_DIGEST_SCHEDULE = "job-digest.schedule";

/**
 * Queue name: make one Profile's Job Digest. Data: { candidateId, profileId }.
 * The Job Digests module selects its Job Offers from those already stored, and
 * runs Job discovery on the Profile's current Search Criteria only when they
 * are too few, handing it the run's Provenance to keep (#336). A failed Job
 * discovery is not retried before the next Job Digest.
 */
export const JOB_DIGEST_RUN = "job-digest.run";

/**
 * Queue name, run every day at 18:00 Europe/Paris: email each Candidate an Appointment Reminder of
 * their Agenda Items of the next day. Safe to run again: one reminder per item and per date.
 */
export const APPOINTMENT_REMINDERS = "appointment-reminders.send";

/** Queue name: re-check the sources of the Job Offers due (those Candidates are applying to), to find Expired Job Offers. Runs daily. */
export const SOURCE_RECHECK = "job-offers.recheck-sources";

/** Queue name: delete the Coach Conversations whose last message is RETENTION_MONTHS old. Runs nightly. */
export const COACH_CONVERSATIONS_PURGE = "coach-conversations.purge";

/**
 * Queue name: delete the Unanswered Questions last asked 12 months ago (RETENTION_MONTHS), and those a Help editor
 * marked written or dismissed 30 days ago (MARKED_RETENTION_DAYS, #344). Runs nightly.
 */
export const UNANSWERED_QUESTIONS_PURGE = "unanswered-questions.purge";

/** Queue name: delete the Signalements marked `traite` SIGNALEMENT_RETENTION_MONTHS ago or more (#374, #283). Runs nightly. */
export const SIGNALEMENTS_PURGE = "signalements.purge";

/** Queue name: delete the Back Office Audit entries made BACK_OFFICE_AUDIT_RETENTION_YEARS ago or more. Runs nightly. */
export const BACK_OFFICE_AUDIT_PURGE = "back-office-audit.purge";
/**
 * Queue name: delete the AI Message Log MESSAGE_LOG_RETENTION_DAYS old, and the AI Usage and
 * external API calls AI_USAGE_RETENTION_MONTHS old. Runs nightly.
 */
export const AI_USAGE_PURGE = "ai-usage.purge";
/** Queue name: delete the Guardrail Triggers GUARDRAIL_TRIGGER_RETENTION_MONTHS old (#228). Runs nightly. */
export const GUARDRAIL_TRIGGERS_PURGE = "guardrail-triggers.purge";
/** Queue name: delete the Back Office Assistant conversations whose last message is 12 months old. Runs nightly. */
export const BACK_OFFICE_ASSISTANT_PURGE = "back-office-assistant.purge";

/**
 * Queue name: re-encrypt the Provider Secrets not under the newest master key of
 * SECRETS_MASTER_KEYS (ADR-0020, docs/ops/provider-secrets.md). Runs nightly, and
 * once when the worker starts, so a new master key is in use soon after it is deployed.
 */
export const PROVIDER_SECRETS_REENCRYPT = "provider-secrets.reencrypt";

/**
 * Queue name: sign Apple's client secret again, from its .p8 key, once a month (#209).
 * Runs daily: it signs only those signed a month ago or more, so a missed day costs nothing.
 * A failure is emailed to the super-admins once per failure streak: Apple sign-in stops when the one in use expires.
 */
export const APPLE_CLIENT_SECRETS = "sign-in-providers.apple-client-secret";

/**
 * Queue name: ask INSEE and France Travail again for the Sectors', Subsectors' and Domains' labels
 * (#236, the reference data). Monthly; a source that fails keeps the labels it had.
 */
export const REFERENCE_DATA_REFRESH = "reference-data.refresh";

/** An Apple client secret that could not be signed again; `firstFailure`: the streak starts, the super-admins are not told yet. */
type AppleFailure = { id: string; reason: "missing_secret" | "invalid_apple_key" | "no_master_key"; firstFailure: boolean };

/** Postgres error code for a table that does not exist yet (the web app's migrations have not run). */
const UNDEFINED_TABLE = "42P01";

/** Job discovery when the worker cannot run it (e.g. no AI keys in local development): why. */
export interface DiscoveryUnavailable {
  unavailable: string;
}

export interface JobsDeps {
  database: Pick<Pool, "query">;
  now?: () => Date;
  /** Job discovery, or why it is unavailable; a getter is asked on each job (the worker's follows its Provider Secrets, #208). */
  discovery: JobDiscovery | DiscoveryUnavailable | (() => JobDiscovery | DiscoveryUnavailable);
  /** Reads a Profile, scoped to its Candidate. Satisfied by the web app's Profiles module. */
  profiles: {
    get(candidateId: string, profileId: string): Promise<DiscoveryProfile | null>;
  };
  /**
   * Where a Job Search started by the Candidate gets its outcome, and where the ones
   * never answered time out. Satisfied by the web app's Job Searches module.
   */
  jobSearches: JobSearchReports;
  /** How often a running Job Search is asked whether its Candidate stopped it. Default: STOP_CHECK_MS. */
  stopCheckMs?: number;
  /** Satisfied by the web app's Follow-ups module. */
  followUps: Pick<FollowUps, "proposeDue">;
  /** The worker's side of Job Digests. Satisfied by the web app's Job Digests module. */
  jobDigests: Pick<JobDigests, "claimDue" | "deliver">;
  /** The Provider Secrets, to move to the newest master key. Without them, nothing to re-encrypt. */
  providerSecrets?: { reencrypt(): Promise<number> };
  /** The Sign-in Providers, whose Apple client secret is signed again monthly. Without them, nothing to sign. */
  signInProviders?: { regenerateAppleClientSecrets(): Promise<{ regenerated: string[]; failed: AppleFailure[] }> };
  /** The Appointment Reminders, sent daily. Satisfied by the web app's Appointment Reminders module. Without them, nothing to send. */
  appointmentReminders?: Pick<AppointmentReminders, "sendDue">;
  /** The reference data, refreshed monthly. Satisfied by the web app's reference data module. Without it, nothing to refresh. */
  referenceData?: Pick<ReferenceData, "refresh">;
  /** Emails the super-admins that an Apple client secret could not be signed again. */
  alertAppleFailure?: (failed: AppleFailure[]) => Promise<void>;
  /** Queues another job of this worker. */
  enqueue: (name: string, data: object) => Promise<void>;
  log?: (line: string) => void;
  /** How the worker reaches job sites. Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Where the source re-check's page reads are recorded (AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
}

/** What Job discovery needs of a Profile: its Search Criteria to search, its Master CV to score what it found. */
interface DiscoveryProfile {
  archived: boolean;
  searchCriteria: SearchCriteria;
  masterCv: { content: CvContent };
}

/**
 * What a Job discovery run measured, as a Job Search or Job Digest keeps it: its
 * funnel down to the Job Offers the Profile matches (Match Score of
 * FUNNEL_MATCH_SCORE or more against its current Master CV), skipped pages by reason, cost,
 * and the job APIs' parts (France Travail's, Fantastic.jobs').
 */
function metricsOf(report: DiscoveryReport, profile: DiscoveryProfile): DiscoveryMetrics {
  const metrics = noDiscoveryMetrics();
  const matched = report.jobOffers.filter(
    (jobOffer) => scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }).score >= FUNNEL_MATCH_SCORE,
  );
  metrics.funnel = { ...report.funnel, afterDedup: report.jobOffers.length, matched: matched.length };
  for (const { reason } of report.skipped) metrics.skipped[reason]++;
  metrics.costEur = report.costEur;
  metrics.franceTravail = { ...report.franceTravail };
  metrics.fantasticJobs = { ...report.fantasticJobs };
  metrics.searchFallback = report.searchFallback ? { ...report.searchFallback } : null;
  return metrics;
}

/**
 * Asks `requested` every `everyMs` until it says yes, then aborts `signal`; `end` stops asking.
 * A question that fails is asked again next time.
 */
function watchStop(requested: () => Promise<boolean>, everyMs: number): { signal: AbortSignal; end(): void } {
  const controller = new AbortController();
  let asking = false;
  const timer = setInterval(() => {
    if (asking) return;
    asking = true;
    requested()
      .then((yes) => {
        if (yes) {
          clearInterval(timer);
          controller.abort(new DOMException("The Candidate stopped the Job Search", "AbortError"));
        }
      })
      .catch(() => undefined)
      .finally(() => (asking = false));
  }, everyMs);
  return { signal: controller.signal, end: () => clearInterval(timer) };
}

function discoveryTarget(data: unknown): { candidateId: string; profileId: string; jobSearchId?: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { candidateId, profileId, jobSearchId } = data as Record<string, unknown>;
  if (typeof candidateId !== "string" || typeof profileId !== "string") return null;
  return typeof jobSearchId === "string" ? { candidateId, profileId, jobSearchId } : { candidateId, profileId };
}

/** Every background job the worker runs, by queue name. */
export function createJobs(deps: JobsDeps): Record<string, JobDefinition> {
  const log = deps.log ?? ((line) => console.info(line));
  const now = deps.now ?? (() => new Date());
  const discoveryNow = () => (typeof deps.discovery === "function" ? deps.discovery() : deps.discovery);
  /** Runs a job that reads the web app's tables: before its migrations have run, there is nothing to do. */
  const onceTablesExist = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
    }
  };
  return {
    // Proves the runner is alive end to end.
    "system.heartbeat": {
      cron: "*/5 * * * *",
      handler: async () => {
        log(`[worker] heartbeat ${new Date().toISOString()}`);
      },
    },

    [JOB_DISCOVERY]: {
      handler: async (data) => {
        const target = discoveryTarget(data);
        if (!target) return log(`[job-discovery] ignored a malformed job`);
        const { jobSearchId } = target;
        const fail = async (reason: string) => {
          if (jobSearchId) await deps.jobSearches.record(jobSearchId, { failed: reason });
        };
        const profile = await deps.profiles.get(target.candidateId, target.profileId);
        if (!profile || profile.archived) {
          await fail("profile_unavailable");
          return log(`[job-discovery] profile ${target.profileId}: gone or archived, skipped`);
        }

        const discovery = discoveryNow();
        if ("unavailable" in discovery) {
          await fail("unavailable");
          return log(
            `[job-discovery] profile ${target.profileId}: skipped, Job discovery is unavailable (${discovery.unavailable})`,
          );
        }
        // Stopped before the worker began it: nothing to run.
        if (jobSearchId && (await deps.jobSearches.stopRequested(jobSearchId))) {
          await deps.jobSearches.record(jobSearchId, { stopped: true, jobOfferIds: [] });
          return log(`[job-discovery] profile ${target.profileId}: stopped by the Candidate before it began`);
        }
        // The Candidate is waiting for this Job Search: each step of the run is written on it as it starts and ends.
        const progress = jobSearchId ? createRunProgress((steps) => deps.jobSearches.progress(jobSearchId, steps)) : null;
        /** What the run measured, its Match Scores recorded as a step of it, and its Provenance; the live steps written first. */
        const measured = async (found: DiscoveryReport) => {
          const metrics = await found.run.step({ rule: "match_score" }, () => metricsOf(found, profile));
          await progress?.flush();
          return { metrics, provenance: found.run.provenance() };
        };
        const idsOf = (found: DiscoveryReport) => found.jobOffers.map((jobOffer) => jobOffer.id);
        // The Candidate can stop this Job Search: asked again and again while it runs.
        const stop = jobSearchId ? watchStop(() => deps.jobSearches.stopRequested(jobSearchId), deps.stopCheckMs ?? STOP_CHECK_MS) : null;
        let report;
        try {
          report = await discovery.discover({ candidateId: target.candidateId, profileId: target.profileId, criteria: profile.searchCriteria, onEvent: progress?.onEvent, signal: stop?.signal });
        } catch (error) {
          stop?.end();
          // The Candidate is waiting for this Job Search: say it failed rather than retry it later.
          if (!jobSearchId) throw error;
          if (error instanceof JobDiscoveryError) {
            const partial = { jobOfferIds: idsOf(error.partial), ...(await measured(error.partial)) };
            // Stopping it broke what was on its way: it is stopped, not failed.
            if (stop?.signal.aborted) {
              await deps.jobSearches.record(jobSearchId, { stopped: true, ...partial });
              return log(`[job-discovery] profile ${target.profileId}: stopped by the Candidate, ${partial.jobOfferIds.length} Job Offer(s) kept`);
            }
            await deps.jobSearches.record(jobSearchId, { failed: "discovery_failed", ...partial });
          } else {
            await progress?.flush();
            await fail("discovery_failed");
          }
          return log(`[job-discovery] profile ${target.profileId}: failed (${error instanceof Error ? error.message : String(error)})`);
        }
        stop?.end();
        const { metrics, provenance } = await measured(report);
        if (jobSearchId && stop?.signal.aborted) {
          await deps.jobSearches.record(jobSearchId, { stopped: true, jobOfferIds: idsOf(report), metrics, provenance });
          return log(`[job-discovery] profile ${target.profileId}: stopped by the Candidate, ${report.jobOffers.length} Job Offer(s) kept`);
        }
        if (jobSearchId) await deps.jobSearches.record(jobSearchId, { jobOfferIds: idsOf(report), metrics, provenance });
        const detail = Object.entries(metrics.skipped)
          .filter(([, count]) => count > 0)
          .map(([reason, count]) => `${reason}: ${count}`)
          .join(", ");
        const { franceTravail, fantasticJobs, searchFallback, targetCompanies } = report;
        log(
          `[job-discovery] profile ${target.profileId}: ${report.jobOffers.length} Job Offer(s), ` +
            `${report.skipped.length} page(s) skipped${detail ? ` (${detail})` : ""}` +
            (franceTravail.status === "off"
              ? ""
              : `, France Travail ${franceTravail.status} (${franceTravail.offers} Job Offer(s), ${franceTravail.calls} call(s))`) +
            (fantasticJobs.status === "off"
              ? ""
              : `, Fantastic.jobs ${fantasticJobs.status} (${fantasticJobs.offers} Job Offer(s), ${fantasticJobs.calls} call(s), €${fantasticJobs.costEur})`) +
            (searchFallback ? `, web search fell back from ${searchFallback.from} to ${searchFallback.to} (${searchFallback.reason})` : "") +
            (targetCompanies.visited > 0 || targetCompanies.laBonneBoite !== "off"
              ? `, Target Companies: ${targetCompanies.visited} visited (${targetCompanies.offers} Job Offer(s)), La Bonne Boite ${targetCompanies.laBonneBoite} (${targetCompanies.calls} call(s))`
              : ""),
        );
      },
    },

    // A Job Search whose discovery job was lost (worker down, job dropped) must not keep its use
    // until the Candidate happens to look at it again. Safe to run again.
    [JOB_SEARCH_TIMEOUTS]: {
      cron: "*/5 * * * *",
      handler: async () => {
        try {
          const expired = await deps.jobSearches.expireTimedOut();
          if (expired) log(`[job-searches] ${expired} Job Search(es) timed out, their use given back`);
        } catch (error) {
          if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        }
      },
    },

    // Working mornings, 6:00 UTC (7:00 or 8:00 in France): the notice emails arrive with the day. Safe to run again.
    [FOLLOW_UPS]: {
      cron: "0 6 * * 1-5",
      handler: async () => {
        try {
          await deps.followUps.proposeDue((deps.now ?? (() => new Date()))());
        } catch (error) {
          if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        }
      },
    },

    // Safe to run again: a Job Digest is claimed once per 07:00.
    [JOB_DIGEST_SCHEDULE]: {
      cron: `0 ${DIGEST_HOUR} * * *`,
      tz: DIGEST_TIME_ZONE,
      handler: async () => {
        try {
          for (const due of await deps.jobDigests.claimDue()) await deps.enqueue(JOB_DIGEST_RUN, due);
        } catch (error) {
          if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        }
      },
    },

    // The day before, at 18:00 French time (the hour never falls in a change of time). Safe to run again.
    [APPOINTMENT_REMINDERS]: {
      cron: `0 ${REMINDER_HOUR} * * *`,
      tz: REMINDER_TIME_ZONE,
      handler: () =>
        onceTablesExist(async () => {
          const sent = await deps.appointmentReminders?.sendDue();
          if (!sent) return;
          log(
            `[appointment-reminders] ${sent.emails} Appointment Reminder(s) sent, for ${sent.items} Agenda Item(s)` +
              (sent.failed ? `; ${sent.failed} could not be sent, left to the next run` : ""),
          );
        }),
    },

    [JOB_DIGEST_RUN]: {
      handler: async (data) => {
        const target = discoveryTarget(data);
        if (!target) return log(`[job-digest] ignored a malformed job`);
        const profile = await deps.profiles.get(target.candidateId, target.profileId);
        if (!profile || profile.archived) return log(`[job-digest] profile ${target.profileId}: gone or archived, skipped`);
        const startedAt = now();
        const discovery = discoveryNow();
        let metrics = noDiscoveryMetrics();
        const discover = async () => {
          if ("unavailable" in discovery) throw new Error(`Job discovery is unavailable (${discovery.unavailable})`);
          try {
            const report = await discovery.discover({ candidateId: target.candidateId, criteria: profile.searchCriteria });
            // The run's Provenance, kept with the Job Digest (#336); the Job Digest scores what it keeps itself.
            const provenance = report.run.provenance();
            metrics = metricsOf(report, profile);
            return { jobOfferIds: report.jobOffers.map((jobOffer) => jobOffer.id), provenance };
          } catch (error) {
            if (error instanceof JobDiscoveryError) metrics = metricsOf(error.partial, profile);
            throw error;
          }
        };
        const delivery = await deps.jobDigests.deliver(target.candidateId, target.profileId, discover);
        const durationMs = now().getTime() - startedAt.getTime();
        const outcome = delivery.digest ? `Job Digest sent (${delivery.digest.results.length} Job Offer(s))` : "nothing to send";
        const discovered = { not_run: "Job discovery not needed", ran: "Job discovery ran", failed: "Job discovery failed" }[delivery.discovery];
        log(`[job-digest] profile ${target.profileId}: ${outcome}, ${discovered}`);
        // Job Digests keep no record of a run that sent nothing: each run's metrics go to the log.
        log(
          JSON.stringify({
            event: "job_digest_run",
            profileId: target.profileId,
            discovery: delivery.discovery,
            sent: delivery.digest?.results.length ?? 0,
            metrics: { ...metrics, durationMs },
          }),
        );
      },
    },

    // Guest data is deleted within 24 hours (ADR-0003); GUEST_RETENTION_HOURS leaves room for this interval.
    "guests.forget": {
      cron: "*/15 * * * *",
      handler: () =>
        onceTablesExist(async () => {
          const forgotten = await forgetExpiredGuestCaptures(deps.database, now());
          if (forgotten) log(`[worker] forgot ${forgotten} Job Offer(s) captured by Guests`);
        }),
    },

    // Coach Conversations are kept 12 months after their last message. Safe to run again.
    [COACH_CONVERSATIONS_PURGE]: {
      cron: "30 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeStaleCoachConversations(deps.database, now());
          if (purged) log(`[coach-conversations] ${purged} Coach Conversation(s) purged, ${RETENTION_MONTHS} months after their last message`);
        }),
    },

    // Nightly, and once at start (main.ts): every row under the newest master key. Safe to run again.
    [PROVIDER_SECRETS_REENCRYPT]: {
      cron: "15 4 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const moved = (await deps.providerSecrets?.reencrypt()) ?? 0;
          if (moved) log(`[provider-secrets] ${moved} Provider Secret(s) re-encrypted under the newest master key`);
        }),
    },

    // Daily; signs again only what is a month old. Safe to run again.
    [APPLE_CLIENT_SECRETS]: {
      cron: "30 4 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const result = await deps.signInProviders?.regenerateAppleClientSecrets();
          if (!result) return;
          if (result.regenerated.length > 0) log(`[sign-in-providers] Apple client secret signed again for ${result.regenerated.join(", ")}`);
          if (result.failed.length === 0) return;
          // Alerted once per failure streak; said in the log every day it lasts.
          const starting = result.failed.filter((failure) => failure.firstFailure);
          log(
            `[sign-in-providers] Apple client secret NOT signed again: ${result.failed.map(({ id, reason }) => `${id} (${reason})`).join(", ")}; ${starting.length > 0 ? "super-admins alerted" : "super-admins already alerted"}`,
          );
          if (starting.length > 0) await deps.alertAppleFailure?.(starting);
        }),
    },

    // The 2nd of each month (the ROME is published twice a year, NAF changes in January 2027). Safe to run again.
    [REFERENCE_DATA_REFRESH]: {
      cron: "0 5 2 * *",
      handler: () =>
        onceTablesExist(async () => {
          const report = await deps.referenceData?.refresh();
          if (!report) return;
          log(
            `[reference-data] ${Object.entries(report)
              .map(([source, outcome]) => (outcome === "refreshed" ? `${source}: refreshed` : `${source}: failed (${outcome.failed}), its labels kept`))
              .join(", ")}`,
          );
        }),
    },

    // Back Office Assistant conversations are kept 12 months after their last message. Safe to run again.
    [BACK_OFFICE_ASSISTANT_PURGE]: {
      cron: "35 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeStaleAssistantConversations(deps.database, now());
          if (purged) log(`[back-office-assistant] ${purged} Back Office Assistant conversation(s) purged, ${ASSISTANT_RETENTION_MONTHS} months after their last message`);
        }),
    },

    // The AI Message Log is kept 30 days, AI Usage 24 months. Safe to run again.
    [AI_USAGE_PURGE]: {
      cron: "50 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeExpiredAiUsage(deps.database, now());
          if (purged.messageLogs || purged.usage || purged.externalApis) {
            log(
              `[ai-usage] ${purged.messageLogs} AI Message Log(s) purged after ${MESSAGE_LOG_RETENTION_DAYS} days, ${purged.usage} AI call(s) and ${purged.externalApis} external API call(s) after ${AI_USAGE_RETENTION_MONTHS} months`,
            );
          }
        }),
    },

    // Guardrail Triggers are kept 24 months, like AI Usage. Safe to run again.
    [GUARDRAIL_TRIGGERS_PURGE]: {
      cron: "55 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeExpiredGuardrailTriggers(deps.database, now());
          if (purged) log(`[guardrails] ${purged} Guardrail Trigger(s) purged, ${GUARDRAIL_TRIGGER_RETENTION_MONTHS} months after they were recorded`);
        }),
    },

    // Unanswered Questions are kept 12 months after they were last asked, 30 days once marked (#344). Safe to run again.
    [UNANSWERED_QUESTIONS_PURGE]: {
      cron: "50 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeUnansweredQuestions(deps.database, now());
          if (purged) log(`[unanswered-questions] ${purged} Unanswered Question(s) purged`);
        }),
    },

    // A Signalement is kept until 12 months after it was marked « traité »; one not yet handled, until it is. Safe to run again.
    [SIGNALEMENTS_PURGE]: {
      cron: "40 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeSignalements(deps.database, now());
          if (purged) log(`[signalements] ${purged} Signalement(s) purged, ${SIGNALEMENT_RETENTION_MONTHS} months after they were marked traité`);
        }),
    },

    // The Back Office Audit is kept 3 years. Safe to run again.
    [BACK_OFFICE_AUDIT_PURGE]: {
      cron: "45 3 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const purged = await purgeExpiredBackOfficeAudit(deps.database, now());
          if (purged) log(`[back-office-audit] ${purged} Back Office Audit entry(ies) purged, ${BACK_OFFICE_AUDIT_RETENTION_YEARS} years after they were made`);
        }),
    },

    // Daily, for the Job Offers an ongoing Application follows whose source was last read
    // RECHECK_INTERVAL_DAYS ago or more (ADR-0002 rules); two gone checks in a row expire one.
    [SOURCE_RECHECK]: {
      cron: "0 4 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const recheck = createSourceRecheck({ store: createSourceChecks(deps.database), fetch: deps.fetch, externalApis: deps.externalApis });
          const report = await recheck.run(now());
          log(
            `[source-recheck] ${report.checked} Job Offer(s) re-checked, ${report.gone.length} gone, ${report.expired.length} expired, ${report.unknown.length} unread`,
          );
        }),
    },
  };
}
