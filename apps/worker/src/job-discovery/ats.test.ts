import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAtsPosting, type JsonResult } from "./ats";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/ats/${name}`, import.meta.url), "utf8"));

/** A pretend set of ATS APIs: what each API URL answers, and the URLs asked. */
function fakeApis(answers: Record<string, JsonResult>) {
  const asked: string[] = [];
  return {
    asked,
    fetchJson: async (url: string): Promise<JsonResult> => {
      asked.push(url);
      return answers[url] ?? { ok: false, reason: "gone" };
    },
  };
}

const days = (n: number) => n * 24 * 60 * 60 * 1000;

describe("Reading a Greenhouse, Lever or Ashby posting through its JSON API", () => {
  describe("Greenhouse", () => {
    const API = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8860302002";
    const firstPublished = new Date("2026-10-02T11:31:50-04:00");

    it("reads the posting from the Job Board API, with its first publication as the posting date", async () => {
      const apis = fakeApis({ [API]: { ok: true, data: fixture("greenhouse-job.json") } });

      const reading = await readAtsPosting("https://job-boards.greenhouse.io/gitlab/jobs/8860302002", {
        ...apis,
        now: new Date(firstPublished.getTime() + days(3)),
      });

      expect(apis.asked).toEqual([API]);
      expect(reading).toEqual({
        ok: true,
        details: {
          title: "Account Executive - France",
          content: expect.stringContaining("As an Account Executive for France, you will own a territory"),
          employer: "GitLab",
          location: "Remote, France",
          postedAt: firstPublished,
        },
      });
      expect(reading?.ok && reading.details.content).not.toMatch(/<|&lt;/);
    });

    it("drops a closed posting: the API no longer has it", async () => {
      const apis = fakeApis({ [API]: { ok: false, reason: "gone" } });

      const reading = await readAtsPosting("https://boards.greenhouse.io/gitlab/jobs/8860302002", { ...apis, now: firstPublished });

      expect(reading).toEqual({ ok: false, reason: "gone" });
    });

    it("drops a posting whose application deadline has passed", async () => {
      const apis = fakeApis({ [API]: { ok: true, data: { ...(fixture("greenhouse-job.json") as object), application_deadline: "2026-10-10" } } });
      const read = (now: string) => readAtsPosting("https://job-boards.greenhouse.io/gitlab/jobs/8860302002", { ...apis, now: new Date(now) });

      expect(await read("2026-10-10T20:00:00Z")).toMatchObject({ ok: true });
      expect(await read("2026-10-11T12:00:00Z")).toEqual({ ok: false, reason: "gone" });
    });

    it("drops a posting first published more than 30 days ago", async () => {
      const apis = fakeApis({ [API]: { ok: true, data: fixture("greenhouse-job.json") } });
      const read = (age: number) =>
        readAtsPosting("https://job-boards.greenhouse.io/gitlab/jobs/8860302002", { ...apis, now: new Date(firstPublished.getTime() + age) });

      expect(await read(days(30))).toMatchObject({ ok: true });
      expect(await read(days(30) + 1000)).toEqual({ ok: false, reason: "too_old" });
    });
  });

  describe("Lever", () => {
    const ID = "ad208490-4052-4f91-a57e-433f2d1e484b";
    const API = `https://api.lever.co/v0/postings/leverdemo/${ID}`;
    const createdAt = new Date("2026-08-31T18:12:19.703Z");

    it("reads the posting from the Postings API, with its creation as the posting date", async () => {
      const apis = fakeApis({ [API]: { ok: true, data: fixture("lever-posting.json") } });

      const reading = await readAtsPosting(`https://jobs.lever.co/leverdemo/${ID}`, { ...apis, now: new Date("2026-09-10T08:00:00Z") });

      expect(apis.asked).toEqual([API]);
      expect(reading).toEqual({
        ok: true,
        details: {
          title: "Customer Success Manager",
          content: expect.stringMatching(/Customer Success Manager to own a portfolio[\s\S]*Skill Set:[\s\S]*3\+ years of account management[\s\S]*equal opportunity employer/),
          location: "Atlanta, Georgia",
          remoteWork: "hybrid",
          postedAt: createdAt,
        },
      });
    });

    it("asks the EU API for a posting on Lever's EU site, and reads the apply page's posting too", async () => {
      const EU_API = `https://api.eu.lever.co/v0/postings/leverdemo/${ID}`;
      const apis = fakeApis({ [EU_API]: { ok: true, data: fixture("lever-posting.json") } });

      const reading = await readAtsPosting(`https://jobs.eu.lever.co/leverdemo/${ID}/apply?lever-source=jobbbox`, {
        ...apis,
        now: new Date("2026-09-10T08:00:00Z"),
      });

      expect(apis.asked).toEqual([EU_API]);
      expect(reading).toMatchObject({ ok: true, details: { title: "Customer Success Manager" } });
    });

    it("keeps a salary stated in euros per year, and leaves another currency out", async () => {
      const posting = fixture("lever-posting.json") as object;
      const salaryOf = async (salaryRange: object) => {
        const apis = fakeApis({ [API]: { ok: true, data: { ...posting, salaryRange } } });
        const reading = await readAtsPosting(`https://jobs.lever.co/leverdemo/${ID}`, { ...apis, now: createdAt });
        return reading?.ok ? reading.details.salary : "dropped";
      };

      expect(await salaryOf({ min: 90000, max: 110000, currency: "EUR", interval: "per-year-salary" })).toEqual({ min: 90000, max: 110000 });
      expect(await salaryOf({ min: 7000, max: 8000, currency: "EUR", interval: "per-month-salary" })).toEqual({ min: 84000, max: 96000 });
      expect(await salaryOf({ min: 85000, max: 175000, currency: "USD", interval: "per-year-salary" })).toBeUndefined();
    });

    it("drops a posting no longer published (Lever hides it from the API) or created more than 30 days ago", async () => {
      const closed = fakeApis({});
      expect(await readAtsPosting(`https://jobs.lever.co/leverdemo/${ID}`, { ...closed, now: createdAt })).toEqual({ ok: false, reason: "gone" });

      const apis = fakeApis({ [API]: { ok: true, data: fixture("lever-posting.json") } });
      expect(await readAtsPosting(`https://jobs.lever.co/leverdemo/${ID}`, { ...apis, now: new Date(createdAt.getTime() + days(31)) })).toEqual({
        ok: false,
        reason: "too_old",
      });
    });
  });
});
