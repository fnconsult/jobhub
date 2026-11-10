import { describe, it, expect } from "vitest";
import { calTeam, teamEvent } from "./cal";
const event = {
  id: 42,
  teamId: 7,
  hosts: [{ userId: 8 }],
  lengthInMinutes: 90,
  bookingUrl: "https://cal.com/team/jobbbox/coach",
  schedulingType: "collective",
};
describe("official Cal.com Teams boundary", () => {
  it("refuses personal/managed/multi-host or foreign URLs/team identities", () => {
    for (const invalid of [
      { ...event, teamId: 9 },
      { ...event, schedulingType: "managed" },
      { ...event, hosts: [{ userId: 8 }, { userId: 9 }] },
      { ...event, assignAllTeamMembers: true },
      { ...event, bookingUrl: "https://other.test/team/jobbbox/coach" },
      { ...event, bookingUrl: "https://cal.com/personal/coach" },
    ])
      expect(() => teamEvent(invalid, 7)).toThrow();
    expect(teamEvent(event, 7)).toMatchObject({ id: 42, hostId: 8, durationMinutes: 90 });
  });
  it("uses verified team endpoints and disables both built-in email roles when creating", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = calTeam({
      apiKey: "test-only",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return Response.json({ status: "success", data: event });
      },
    });
    await api.createEventType({ teamId: 7, hostId: 8, durationMinutes: 90, title: "Coach", slug: "jobbbox-coach" });
    expect(calls[0]!.url).toBe("https://api.cal.com/v2/teams/7/event-types");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      schedulingType: "collective",
      hosts: [{ userId: 8 }],
      lengthInMinutes: 90,
      hidden: true,
      emailSettings: { disableEmailsToAttendees: true, disableEmailsToHosts: true },
    });
    await api.eventType(7, 42);
    expect(calls[1]!.url).toContain("/teams/7/event-types/42");
  });
  it("refuses an API response for another requested event or creation host", async () => {
    const wrong = calTeam({ apiKey: "test-only", fetch: async () => Response.json({ status: "success", data: { ...event, id: 99 } }) });
    await expect(wrong.eventType(7, 42)).rejects.toThrow("identity mismatch");
    const host = calTeam({ apiKey: "test-only", fetch: async () => Response.json({ status: "success", data: { ...event, hosts: [{ userId: 99 }] } }) });
    await expect(host.createEventType({ teamId: 7, hostId: 8, durationMinutes: 90, title: "Coach", slug: "coach" })).rejects.toThrow("context mismatch");
  });
  it("recovers an interrupted remote cancellation without repeating it and pins the booking API version", async () => {
    let state = "accepted",
      posts = 0;
    const versions: string[] = [];
    const api = calTeam({
      apiKey: "test-only",
      fetch: async (url, init) => {
        versions.push(new Headers(init?.headers).get("cal-api-version")!);
        if (init?.method === "POST") {
          posts++;
          state = "cancelled";
          throw new Error("connection lost after cancellation");
        }
        return Response.json({ status: "success", data: { uid: "cal_one", status: state } });
      },
    });
    await expect(api.cancel("cal_one")).rejects.toThrow();
    await api.cancel("cal_one");
    expect(posts).toBe(1);
    expect(new Set(versions)).toEqual(new Set(["2024-08-13"]));
  });
});
