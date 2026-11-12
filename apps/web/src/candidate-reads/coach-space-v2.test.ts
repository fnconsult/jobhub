import { agendaResponseSchema, coachConversationResponseSchema, coachingOrderResponseSchema, coachingResponseSchema } from "@jobhub/shared/reads";
import { JOBBBOX_SELLER } from "@jobhub/shared/coaching-offers";
import { describe, expect, it, vi } from "vitest";
import { createCandidateReads, type CandidateReadsDeps } from "./index";

/**
 * « Espace coach v2 » (ADR-0106) on the app's reads, without a database: off, `GET /api/agenda`, `/api/coaching`,
 * `/api/coaching/order` and a Coach Conversation answer as before the Human Coach epic, and the epic's deps are never
 * asked; on, they carry the epic's fields.
 */
const CANDIDATE = "candidate-1";
const SESSION = {
  id: "s1",
  coach: { id: "coach-1", name: "Claire Martin", bookingUrl: "https://cal.com/claire" },
  paidAt: new Date("2026-10-18T10:00:00.000Z"),
  scheduledAt: new Date("2026-10-23T07:00:00.000Z"),
  durationMinutes: 60,
  videoLink: "https://meet.google.com/abc",
  note: null,
  changedBy: "candidate",
  reschedules: [],
};
const PAGE = { versionId: "v1", presentation: "Coach carrière.", specialties: [], languages: [], photoUrl: null };
const SELLER = JOBBBOX_SELLER;

function deps(on: boolean) {
  const epic = {
    coachPages: vi.fn(async () => [{ coachId: "coach-1", page: PAGE }]),
    coachAssociations: vi.fn(async () => [{ coachId: "coach-1", id: "association-1", name: "Transitions" }]),
    coachingOffer: vi.fn(async () => ({ seller: SELLER, durationMinutes: 60, amount: 9000, currency: "eur" })),
    coachingCancellations: vi.fn(async () => true),
    coachingBookings: vi.fn(async () => ({ s1: "/coachs/seances/11111111-1111-1111-1111-111111111111/reserver" })),
    coachingMeetings: vi.fn(async () => ({ s1: { kind: "video" as const, target: "https://meet.google.com/abc", confirmed: true } })),
    coachingTimeZone: vi.fn(async () => "America/Montreal"),
  };
  const days = vi.fn(async () => [
    {
      day: "2026-10-23",
      items: [{ kind: "coachingSession", ...SESSION, coach: { id: "coach-1", name: "Claire Martin" }, scheduledAt: SESSION.scheduledAt }],
    },
  ]);
  const message = { from: "coach", text: "Compte rendu", humanCoach: { id: "coach-1", name: "Claire Martin", photoUrl: null } };
  const conversation = {
    id: "conv-1",
    title: "Séance",
    subject: null,
    profile: null,
    lastMessageAt: new Date("2026-10-23T09:00:00.000Z"),
    aiDisclosure: false,
    messages: [message],
    context: { messages: 1, tokens: 10 },
  };
  const all = {
    coachSpaceV2: () => on,
    ...epic,
    agenda: { unscheduled: vi.fn(async () => []), days },
    humanCoaches: {
      list: vi.fn(async () => [{ id: "coach-1", name: "Claire Martin", bio: "15 ans de RH." }]),
      accessGranted: vi.fn(async () => ["coach-1"]),
      sessions: vi.fn(async () => [SESSION]),
    },
    withdrawals: { contracts: vi.fn(async () => []) },
    billing: { coachingSessionPrice: vi.fn(async () => ({ amount: 9000, regularAmount: 9000, currency: "eur" })) },
    orders: {
      terms: vi.fn(async () => ({
        summary: { subject: { fr: "Claire Martin" }, price: { amount: 9000, currency: "eur" }, sale: { seller: SELLER, durationMinutes: 60 } },
        cgv: null,
      })),
    },
    coachConversations: { open: vi.fn(async () => conversation), ofSubject: vi.fn(), list: vi.fn() },
  };
  return { all: all as unknown as CandidateReadsDeps, epic, days };
}

const overHttp = <T>(schema: { parse(value: unknown): T }, value: unknown): T => schema.parse(JSON.parse(JSON.stringify(value)));

describe("the app's reads, « Espace coach v2 » off: as before the Human Coach epic", () => {
  it("answers Mes coachs humains in main's shape, and never asks the epic's deps", async () => {
    const { all, epic } = deps(false);
    const coaching = overHttp(coachingResponseSchema, await createCandidateReads(all).coaching(CANDIDATE));
    expect(coaching).toEqual({
      coaches: [{ id: "coach-1", name: "Claire Martin", bio: "15 ans de RH.", accessGranted: true }],
      sessions: [
        {
          id: "s1",
          coach: SESSION.coach,
          paidAt: "2026-10-18T10:00:00.000Z",
          scheduledAt: "2026-10-23T07:00:00.000Z",
          durationMinutes: 60,
          videoLink: "https://meet.google.com/abc",
          note: null,
          changedBy: "candidate",
          reschedules: [],
          withdrawable: false,
        },
      ],
      price: { amount: 9000, regularAmount: 9000, currency: "eur" },
    });
    for (const dep of Object.values(epic)) expect(dep).not.toHaveBeenCalled();
  });

  it("answers the Agenda without a time zone or a meeting, and asks its days as main did", async () => {
    const { all, epic, days } = deps(false);
    const agenda = overHttp(agendaResponseSchema, await createCandidateReads(all).agenda(CANDIDATE));
    const [item] = agenda.days[0]!.items;
    expect(item).not.toHaveProperty("timeZone");
    expect(item).not.toHaveProperty("meeting");
    expect(days.mock.calls[0] as unknown[]).toEqual([CANDIDATE, { period: "upcoming", now: expect.any(Date) }]);
    expect(epic.coachingTimeZone).not.toHaveBeenCalled();
    expect(epic.coachingMeetings).not.toHaveBeenCalled();
  });

  it("answers the Order without its Seller, and a message without its Human Coach", async () => {
    const { all } = deps(false);
    const reads = createCandidateReads(all);
    expect(overHttp(coachingOrderResponseSchema, await reads.coachingOrder(CANDIDATE, "coach-1"))).toEqual({
      coach: { id: "coach-1", name: "Claire Martin" },
      price: { amount: 9000, currency: "eur" },
      cgv: null,
    });
    const read = overHttp(coachConversationResponseSchema, await reads.coachConversation(CANDIDATE, "conv-1"));
    expect(read.conversation?.messages[0]).not.toHaveProperty("humanCoach");
  });

  it("is off when the dep is absent", async () => {
    const { all, epic } = deps(false);
    const coaching = await createCandidateReads({ ...all, coachSpaceV2: undefined }).coaching(CANDIDATE);
    expect(coaching).not.toHaveProperty("timeZone");
    for (const dep of Object.values(epic)) expect(dep).not.toHaveBeenCalled();
  });
});

describe("the app's reads, « Espace coach v2 » on: the Human Coach epic's", () => {
  it("answers Mes coachs humains with the profile, Association, Seller, offer, meeting, booking and time zone", async () => {
    const { all } = deps(true);
    const coaching = overHttp(coachingResponseSchema, await createCandidateReads(all).coaching(CANDIDATE));
    expect(coaching.timeZone).toBe("America/Montreal");
    expect(coaching.cancellationPath).toBe("/coachs/annulations");
    expect(coaching.coaches[0]).toMatchObject({
      profile: PAGE,
      association: { id: "association-1", name: "Transitions" },
      seller: SELLER,
      offer: { durationMinutes: 60, amount: 9000, currency: "eur" },
    });
    expect(coaching.sessions[0]).toMatchObject({
      meeting: { kind: "video", target: "https://meet.google.com/abc", confirmed: true },
      bookingPath: "/coachs/seances/11111111-1111-1111-1111-111111111111/reserver",
    });
  });

  it("answers the Agenda with the time zone and meeting, the Order with its Seller, a message with its Human Coach", async () => {
    const { all, days } = deps(true);
    const reads = createCandidateReads(all);
    const agenda = overHttp(agendaResponseSchema, await reads.agenda(CANDIDATE));
    expect(agenda.days[0]!.items[0]).toMatchObject({ timeZone: "America/Montreal", meeting: { kind: "video" } });
    expect((days.mock.calls[0] as unknown[])[1]).toMatchObject({ timeZone: "America/Montreal" });
    expect(overHttp(coachingOrderResponseSchema, await reads.coachingOrder(CANDIDATE, "coach-1"))).toMatchObject({ seller: SELLER, durationMinutes: 60 });
    const read = overHttp(coachConversationResponseSchema, await reads.coachConversation(CANDIDATE, "conv-1"));
    expect(read.conversation?.messages[0]).toMatchObject({ humanCoach: { id: "coach-1", name: "Claire Martin" } });
  });
});
