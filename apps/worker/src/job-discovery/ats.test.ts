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
});
