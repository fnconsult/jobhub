import { describe, expect, it } from "vitest";
import { asBeforeCoachSpaceV2, type CandidateDataExport } from "./index";

const ACCOUNT = { email: "marie.dupont@example.fr", name: null, givenName: null, familyName: null, preferredName: null, interfaceLanguage: "fr", createdAt: new Date("2026-01-01T00:00:00Z"), signInMethods: [], sessions: [], backOfficeRoles: [] };
const SESSION = { id: "s1", coach: { id: "c1", name: "Camille Martin" }, amount: 9000, currency: "eur", paidAt: new Date("2026-10-02T09:00:00Z"), scheduledAt: null, durationMinutes: null, videoLink: null, note: null, changedBy: "candidate", reschedules: [] };
/** The parts of an export this gate touches; the rest passes through unchanged. */
function exported(v2: Record<string, unknown>, account: Record<string, unknown> = { coachingTimeZone: null }, meeting: unknown = null): CandidateDataExport {
  const empty = { coachingTax: { identities: [], submissions: [] }, contentReports: { reports: [] }, coachingNotifications: { settings: null, notices: [] }, coachingCancellations: { cancellations: [], events: [] }, coachingRefunds: { refunds: [] }, calBookings: { bookings: [] }, connectMoney: { purchases: [] }, coachPages: [], associationActivity: { activity: [] }, coachContractAcceptances: [], coachContractNotices: [], coachEnrolments: [], managedAssociations: [], coachingSales: [], coachingQuotes: [], sharedReading: [], sessionReports: [], privateCoachNotes: [] };
  return { exportedAt: new Date(), account: { ...ACCOUNT, ...account }, coachingSessions: [{ ...SESSION, meeting }], orders: [], ...empty, ...v2 } as unknown as CandidateDataExport;
}

describe("the Candidate data export behind « Espace coach v2 » (ADR-0106)", () => {
  it("off, for a Candidate the Human Coach epic never touched: main's export, without its sections or fields", () => {
    expect(asBeforeCoachSpaceV2(exported({}))).toEqual({ exportedAt: expect.any(Date), account: ACCOUNT, coachingSessions: [SESSION], orders: [] });
  });

  it("off, data the epic did leave is still exported (right of access)", () => {
    const note = { coachName: "Sophie", sessionId: null, text: "Notes", updatedAt: new Date() };
    const out = asBeforeCoachSpaceV2(exported({ privateCoachNotes: [note] }, { coachingTimeZone: "America/Montreal" }, { kind: "visio" }));
    expect(out.privateCoachNotes).toEqual([note]);
    expect(out.account?.coachingTimeZone).toBe("America/Montreal");
    expect(out.coachingSessions[0]?.meeting).toEqual({ kind: "visio" });
    expect(out).not.toHaveProperty("sessionReports");
  });
});
