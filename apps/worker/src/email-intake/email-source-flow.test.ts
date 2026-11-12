import { describe, expect, it, vi } from "vitest";
import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { type JobOfferDetails } from "@jobhub/shared";
import { inboundTextOf } from "../../../web/src/email-intake/inbound-email";
import { createEmailReading } from "./index";
import { createEmailSourceReader, EmailSourceUnread } from "./source-reading";

vi.mock("@jobhub/web/task-playbooks", () => ({ servedTaskRun: async () => ({ instructions: () => ({ text: "Read offers only." }) }) }));
const url = "https://careers.example.org/jobs/finance";
const now = new Date("2026-11-11T09:00:00Z");
const details: JobOfferDetails = { title: "Finance director", content: "Lead financial consolidation. IFRS required. Ten years of experience.", employer: "Example", location: "Lyon", contractType: "cdi", skills: ["IFRS"], requiredExperienceYears: 10, postedAt: new Date("2026-11-08T00:00:00Z") };
const masterCv = { fullName: "Fixture", headline: "Finance director", email: "", phone: "", location: "Lyon", summary: "", experience: [{ title: "Finance director", employer: "Example", period: "2010 – present", location: "Lyon", description: "Finance" }], education: [], skills: ["IFRS"], languages: [] };
const searchCriteria = { targetRole: "Finance director", locations: ["Lyon"], contractTypes: ["cdi" as const], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

function fixture({ kind = "alerte", link = url as string | null, text = `Finance director <${url}>`, readSource = vi.fn(async () => ({ url, details })), seen = false, attempt = 1, privateStored = false, offers = [{ title: "Finance director", link }] as { title: string; link: string | null }[], refused = false } = {}) {
  const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", reply: JSON.stringify({ kind, offers }) })], routes: { offer_email_reading: "mistral", offer_analysis: "mistral" }, usage: createMemoryUsageLog(), warn: () => {} });
  const capture = vi.fn(async (input, _by, trusted) => refused ? ({ ok: false as const, error: "invalid" }) as never : ({ ok: true as const, created: true, jobOffer: { id: "offer-fixture", ...input, ...trusted } }));
  const recorded = vi.fn();
  const failed = vi.fn();
  const tryFailed = vi.fn();
  const worker = createEmailReading({ ai, now: () => now, readSource,
    profiles: { list: async () => [{ id: "profile-fixture", archived: false }], get: async () => ({ id: "profile-fixture", archived: false, searchCriteria, masterCv: { content: masterCv } }) },
    guardrails: { guardEmail: async ({ read }) => ({ outcome: "read", reading: await read(), checks: [] }) },
    readings: { startTry: async () => ({ id: "email-fixture", candidateId: "candidate-fixture", senderDomain: "example.org", manualForward: true, receivedAt: now, sentAt: now, text, try: attempt }), alreadyThere: async () => seen, progress: async () => {}, read: recorded, tryFailed, failed, setAside: async () => {} },
    jobOffers: { findBySourceUrl: async () => seen || privateStored ? { id: "offer-fixture", privateToCandidateId: privateStored ? "another-candidate" : undefined } as never : null, capture },
  });
  return { worker, readSource, capture, recorded, failed, tryFailed };
}

describe("email alert source reading before classification (#973)", () => {
  it("stores source fields and publication date, and assigns a Profile using the enriched score", async () => {
    const f = fixture({ text: inboundTextOf({ html: `<p>New jobs</p><a href="${url}?utm_source=email">Finance director</a>` }), link: `${url}?utm_source=email` });
    await expect(f.worker.read("email-fixture")).resolves.toEqual({ outcome: "offers_found" });
    expect(f.capture.mock.calls[0]![0]).toMatchObject({ title: details.title, content: details.content, skills: details.skills, requiredExperienceYears: 10, source: { url } });
    expect(f.readSource).toHaveBeenCalledOnce();
    expect(f.capture.mock.calls[0]![2]).toMatchObject({ postedAt: details.postedAt });
    expect(f.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "new", jobOfferId: "offer-fixture", profileId: "profile-fixture", matchScore: 100 }] });
  });
  it("recovers an omitted HTML anchor link when the exact title has one destination", async () => {
    const f = fixture({ link: null });
    await f.worker.read("email-fixture");
    expect(f.readSource).toHaveBeenCalledWith(url, expect.anything());
  });
  it("uses a tracked plain text link's normalized destination", async () => {
    const link = `https://click.example.org/go?url=${encodeURIComponent(url)}&utm_source=email`;
    const f = fixture({ link, text: `Finance director <${link}>` });
    await f.worker.read("email-fixture");
    expect(f.readSource).toHaveBeenCalledWith(url, expect.anything());
  });
  it("records a refused source À capturer at once, without scoring or creating a heading-only offer", async () => {
    const f = fixture({ readSource: vi.fn(async () => { throw new EmailSourceUnread("gone", false); }) });
    await f.worker.read("email-fixture");
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.tryFailed).not.toHaveBeenCalled();
    expect(f.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "to_capture", title: "Finance director", link: url }] });
  });
  it("tries again a source that did not answer, and records it À capturer on the last try", async () => {
    const unreachable = () => vi.fn(async () => { throw new EmailSourceUnread("unreachable", true); });
    const first = fixture({ readSource: unreachable() });
    await expect(first.worker.read("email-fixture")).rejects.toThrow("unreachable");
    expect(first.tryFailed).toHaveBeenCalledOnce();
    expect(first.recorded).not.toHaveBeenCalled();
    const last = fixture({ readSource: unreachable(), attempt: 3 });
    expect(await last.worker.read("email-fixture")).toEqual({ outcome: "offers_found" });
    expect(last.capture).not.toHaveBeenCalled();
    expect(last.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "to_capture", title: "Finance director", link: url }] });
  });
  it("records À capturer a source whose posting the Job Offers refuse, rather than dropping it", async () => {
    const f = fixture({ refused: true });
    await f.worker.read("email-fixture");
    expect(f.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "to_capture", title: "Finance director", link: url }] });
  });
  it("does not fetch a Forbidden site", async () => {
    const f = fixture({ link: "https://www.linkedin.com/jobs/view/1234567890/" });
    await f.worker.read("email-fixture");
    expect(f.readSource).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });
  it("bounds retries for a missing or ambiguously associated link", async () => {
    const f = fixture({ link: null, text: "Finance director", attempt: 1 });
    await expect(f.worker.read("email-fixture")).rejects.toThrow("unambiguous");
    expect(f.tryFailed).toHaveBeenCalledOnce();
    const last = fixture({ link: null, text: `Finance director <${url}>\nFinance director <https://careers.example.org/jobs/other>`, attempt: 3 });
    expect(await last.worker.read("email-fixture")).toEqual({ outcome: "failed" });
    expect(last.failed).toHaveBeenCalledOnce();
    expect(last.capture).not.toHaveBeenCalled();
  });
  it("on the last try leaves out only the offer without a link, and records the email's others", async () => {
    const f = fixture({ attempt: 3, text: `Finance director <${url}>\nControl lead`, offers: [{ title: "Finance director", link: url }, { title: "Control lead", link: null }] });
    expect(await f.worker.read("email-fixture")).toEqual({ outcome: "offers_found" });
    expect(f.failed).not.toHaveBeenCalled();
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "new", jobOfferId: "offer-fixture", profileId: "profile-fixture", matchScore: 100 }] });
  });
  it("does not reimport a duplicate on retry, nor read its source again", async () => {
    const f = fixture({ seen: true, attempt: 2 });
    await f.worker.read("email-fixture");
    expect(f.readSource).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.recorded).toHaveBeenCalledWith("email-fixture", { kind: "alert", offers: [{ disposition: "seen", jobOfferId: "offer-fixture" }] });
  });
  it("keeps recruiter correspondence private and never sends it to a source reader", async () => {
    const f = fixture({ kind: "recruteur" });
    await f.worker.read("email-fixture");
    expect(f.readSource).not.toHaveBeenCalled();
    expect(f.capture.mock.calls[0]![2]).toMatchObject({ privateTo: "candidate-fixture" });
    expect(f.capture.mock.calls[0]![2].postedAt).toBeUndefined();
  });
});

it("the actual polite source reader blocks a redirect to a private address", async () => {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  const reader = createEmailSourceReader({ fetch, clock: { now: () => 0, sleep: async () => {} } });
  await expect(reader(url, {} as never)).rejects.toThrow("not_public");
  expect(fetch.mock.calls.every(([input]) => !String(input).includes("127.0.0.1"))).toBe(true);
});

it("the real reader extracts public JSON-LD and fills fields from its text without sending email correspondence", async () => {
  const provider = createFakeProvider({ id: "mistral", reply: JSON.stringify({ skills: ["IFRS"], requiredExperienceYears: 10 }) });
  const ai = createAiLayer({ providers: [provider], routes: { offer_analysis: "mistral" }, usage: createMemoryUsageLog(), warn: () => {} });
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Finance director", description: "Lead IFRS consolidation. Ten years required.", datePosted: "2026-11-08" })}</script>`;
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => new Response(String(input).endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : html, { headers: { "content-type": String(input).endsWith("/robots.txt") ? "text/plain" : "text/html" } }));
  const result = await createEmailSourceReader({ fetch, clock: { now: () => 0, sleep: async () => {} } })(url, ai);
  expect(result.details).toMatchObject({ title: "Finance director", content: "Lead IFRS consolidation. Ten years required.", skills: ["IFRS"], requiredExperienceYears: 10, postedAt: details.postedAt });
  expect(provider.calls[0]!.messages[0]!.content).toContain("Lead IFRS consolidation");
});
