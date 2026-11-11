import { resources, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { PUSH_EVENTS, type PushNotification } from "./catalog";
import { pushMessage } from "./messages";

/** Names a notification could be tempted to carry: a company, a job, a person, as the objects behind it hold them. */
const NAMES = ["Acme Industrie", "Groupe Seb", "DAF H/F", "Directrice financière", "Marie Dupont", "Paul Martin", "Claire Coach"];

const JOB_SEARCH = "7f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const JOB_DIGEST = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const APPLICATION = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const CANDIDATE = "cand_marie";

/** One notification of each event, about the objects above. */
const ONE_OF_EACH: Record<PushNotification["event"], PushNotification> = {
  job_search_results: { event: "job_search_results", jobSearchId: JOB_SEARCH },
  job_digest: { event: "job_digest", jobDigestId: JOB_DIGEST },
  appointment_reminder: { event: "appointment_reminder" },
  coach_review: { event: "coach_review", applicationId: APPLICATION },
  coaching_session_changed: { event: "coaching_session_changed" },
  coaching_cancellation: { event: "coaching_cancellation" },
  follow_up_due: { event: "follow_up_due", applicationId: APPLICATION },
  coach_access_granted: { event: "coach_access_granted", candidateId: CANDIDATE },
  coaching_session_paid: { event: "coaching_session_paid" },
  coaching_session_changed_by_candidate: { event: "coaching_session_changed_by_candidate" },
  test: { event: "test" },
};

describe("a Push notification's text (ADR-0076: a lock screen is public)", () => {
  it("has a notification for every event of the catalogue, and the Back Office's test", () => {
    expect(Object.keys(ONE_OF_EACH).sort()).toEqual([...PUSH_EVENTS.map((event) => event.id), "test"].sort());
  });

  for (const notification of Object.values(ONE_OF_EACH)) {
    for (const locale of SUPPORTED_LOCALES) {
      it(`never names a company, a job or a person: ${notification.event} (${locale})`, () => {
        const { title, body } = pushMessage(notification, locale);
        expect(title.length).toBeGreaterThan(0);
        expect(body.length).toBeGreaterThan(0);
        for (const text of [title, body]) {
          for (const name of NAMES) expect(text).not.toContain(name);
          // Nothing filled in: no placeholder left, no id shown.
          expect(text).not.toMatch(/\{\{|\}\}/);
          for (const id of [JOB_SEARCH, JOB_DIGEST, APPLICATION, CANDIDATE]) expect(text).not.toContain(id);
        }
      });
    }
  }

  it("takes nothing to fill in from the catalogues: every gabarit is a fixed text, in every language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = resources[locale].translation.pushNotifications.messages;
      for (const [event, { title, body }] of Object.entries(messages)) {
        expect(`${event}: ${title}`).not.toMatch(/\{\{/);
        expect(`${event}: ${body}`).not.toMatch(/\{\{/);
      }
      expect(Object.keys(messages).sort()).toEqual(Object.keys(ONE_OF_EACH).sort());
    }
  });

  it("reads « Nouveaux résultats pour une recherche » for a Job Search's results, in French", () => {
    expect(pushMessage(ONE_OF_EACH.job_search_results, "fr").title).toBe("Nouveaux résultats pour une recherche");
    expect(pushMessage(ONE_OF_EACH.job_search_results, "en").title).toBe("New results for a search");
  });
});

describe("a Push notification's deep link (the app fetches the rest once opened)", () => {
  it("opens the object it is about, by its id only", () => {
    expect(pushMessage(ONE_OF_EACH.job_search_results, "fr").path).toBe(`/recherches/${JOB_SEARCH}`);
    expect(pushMessage(ONE_OF_EACH.job_digest, "fr").path).toBe(`/job-digests/${JOB_DIGEST}`);
    expect(pushMessage(ONE_OF_EACH.coach_review, "fr").path).toBe(`/candidatures/${APPLICATION}`);
    expect(pushMessage(ONE_OF_EACH.follow_up_due, "fr").path).toBe(`/candidatures/${APPLICATION}`);
    expect(pushMessage(ONE_OF_EACH.coach_access_granted, "fr").path).toBe(`/espace-coach/${CANDIDATE}`);
  });

  it("opens the Agenda, the coach space or the home page for an event about no one object", () => {
    expect(pushMessage(ONE_OF_EACH.appointment_reminder, "en").path).toBe("/agenda?vue=liste");
    expect(pushMessage(ONE_OF_EACH.coaching_session_changed, "en").path).toBe("/agenda?vue=liste");
    expect(pushMessage(ONE_OF_EACH.coaching_session_paid, "en").path).toBe("/espace-coach");
    expect(pushMessage(ONE_OF_EACH.coaching_session_changed_by_candidate, "en").path).toBe("/espace-coach");
    expect(pushMessage(ONE_OF_EACH.test, "en").path).toBe("/");
  });

  it("is the same in every language", () => {
    for (const notification of Object.values(ONE_OF_EACH)) expect(pushMessage(notification, "en").path).toBe(pushMessage(notification, "fr").path);
  });
});

describe("a notification as a queued job carries it", () => {
  it("is read back as its event and its object's id, nothing more", async () => {
    const { pushNotificationOf } = await import("./catalog");
    for (const notification of Object.values(ONE_OF_EACH)) expect(pushNotificationOf(JSON.parse(JSON.stringify(notification)))).toEqual(notification);
    expect(pushNotificationOf({ event: "job_search_results", jobSearchId: JOB_SEARCH, title: "DAF chez Acme Industrie" })).toEqual(
      ONE_OF_EACH.job_search_results,
    );
  });

  it("is refused for an unknown event, a missing or odd id", async () => {
    const { pushNotificationOf } = await import("./catalog");
    expect(pushNotificationOf({ event: "spam" })).toBeNull();
    expect(pushNotificationOf({ event: "toString" })).toBeNull();
    expect(pushNotificationOf({ event: "job_digest" })).toBeNull();
    expect(pushNotificationOf({ event: "coach_review", applicationId: "../admin" })).toBeNull();
    expect(pushNotificationOf(null)).toBeNull();
  });
});

describe("the events a person sees in Rappels", () => {
  it("are a Candidate's for every account, and a Human Coach's own too, in the catalogue's order", async () => {
    const { pushAudiencesOf, pushEventsFor } = await import("./catalog");
    expect(pushEventsFor(pushAudiencesOf(false))).toEqual([
      "job_search_results",
      "job_digest",
      "appointment_reminder",
      "coach_review",
      "coaching_session_changed",
      "coaching_cancellation",
      "follow_up_due",
    ]);
    expect(pushEventsFor(pushAudiencesOf(true)).slice(7)).toEqual(["coach_access_granted", "coaching_session_paid", "coaching_session_changed_by_candidate"]);
  });
});
