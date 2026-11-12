import { expect, it, vi } from "vitest";
import { EMAIL_REPAIR_BATCH_LIMIT, planEmailOfferRepairs, type EmailRepairInput } from "./repair-plan";
const now = new Date("2026-11-11T09:00:00Z");
const input: EmailRepairInput = { jobOfferId: "offer-fixture", private: false, sourceUrl: "https://careers.example.org/jobs/one", profiles: [] };
const details = { title: "Director", content: "Public responsibilities", skills: ["IFRS"], postedAt: new Date("2026-11-09") };
it("proposes enriched details for the same stored identity, without any write interface", async () => {
  const readSource = vi.fn(async () => ({ url: input.sourceUrl!, details }));
  expect(await planEmailOfferRepairs([input], { ai: {} as never, now, readSource })).toEqual([{ jobOfferId: input.jobOfferId, outcome: "proposed", sourceUrl: input.sourceUrl, details, assignments: [] }]);
  expect(readSource).toHaveBeenCalledOnce();
});
it("skips private imports and missing historical links without querying externally", async () => {
  const readSource = vi.fn();
  const plans = await planEmailOfferRepairs([{ ...input, private: true }, { ...input, jobOfferId: "other", sourceUrl: null }], { ai: {} as never, now, readSource });
  expect(plans.map((plan) => plan.reason)).toEqual(["private", "missing_link"]);
  expect(readSource).not.toHaveBeenCalled();
});
it("refuses oversized or duplicate batches before reading a source", async () => {
  const readSource = vi.fn();
  await expect(planEmailOfferRepairs(Array.from({ length: EMAIL_REPAIR_BATCH_LIMIT + 1 }, () => input), { ai: {} as never, now, readSource })).rejects.toThrow("exceeds");
  await expect(planEmailOfferRepairs([input, input], { ai: {} as never, now, readSource })).rejects.toThrow("Duplicate");
  expect(readSource).not.toHaveBeenCalled();
});
it("leaves inaccessible and stale offers untouched", async () => {
  const readSource = vi.fn(async () => { throw new Error("robots"); });
  expect((await planEmailOfferRepairs([input], { ai: {} as never, now, readSource }))[0]).toMatchObject({ outcome: "skipped", reason: "unread_source" });
  const stale = async () => ({ url: input.sourceUrl!, details: { ...details, postedAt: new Date("2026-01-01") } });
  expect((await planEmailOfferRepairs([input], { ai: {} as never, now, readSource: stale }))[0]).toMatchObject({ outcome: "skipped", reason: "too_old" });
});

it("recalculates each Candidate's best Profile from the enriched source before proposing assignments", async () => {
  const cv = { fullName: "Fixture", headline: "Finance director", email: "", phone: "", location: "Lyon", summary: "", experience: [{ title: "Finance director", employer: "Example", location: "Lyon", period: "2010 – present", description: "Finance" }], education: [], skills: ["IFRS"], languages: [] };
  const criteria = { targetRole: "Finance director", locations: ["Lyon"], contractTypes: ["cdi" as const], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
  const poor = { candidateId: "candidate-one", profileId: "poor-profile", cv: { ...cv, experience: [], skills: [] }, searchCriteria: { ...criteria, locations: ["Paris"], contractTypes: ["cdd" as const] } };
  const readSource = vi.fn(async () => ({ url: input.sourceUrl!, details: { ...details, location: "Lyon", contractType: "cdi" as const, requiredExperienceYears: 10 } }));
  const plans = await planEmailOfferRepairs([{ ...input, profiles: [poor, { candidateId: "candidate-one", profileId: "matching-profile", cv, searchCriteria: criteria }, { ...poor, candidateId: "candidate-two" }] }], { ai: {} as never, now, readSource });
  expect(plans[0]).toMatchObject({ jobOfferId: input.jobOfferId, outcome: "proposed", assignments: [{ candidateId: "candidate-one", profileId: "matching-profile", matchScore: 100 }, { candidateId: "candidate-two", profileId: null, matchScore: 0 }] });
  expect(readSource).toHaveBeenCalledWith(input.sourceUrl, {});
});
