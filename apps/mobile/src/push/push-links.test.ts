import { pushLinkOf } from "./push-links";

/** A Push notification as expo-notifications gives it: `data` (FCM's data; APNs' `body`), `trigger.payload` (iOS' whole payload). */
const tapped = (data: unknown, payload?: unknown) => ({ notification: { request: { content: { data }, trigger: payload === undefined ? null : { type: "push", payload } } } });

const ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

describe("where a Push notification opens in the app (#699)", () => {
  it("opens each event's object by its id alone, on the app's page for it", () => {
    expect(pushLinkOf(tapped({ path: `/candidatures/${ID}` }))).toBe(`/candidatures/${ID}`);
    expect(pushLinkOf(tapped({ path: `/espace-coach/${ID}` }))).toBe(`/espace-coach/${ID}`);
    expect(pushLinkOf(tapped({ path: "/espace-coach" }))).toBe("/espace-coach");
    expect(pushLinkOf(tapped({ path: "/agenda?vue=liste" }))).toBe("/agenda");
    expect(pushLinkOf(tapped({ path: "/" }))).toBe("/");
  });

  it("opens Recherches d'offres and Job Digests for a Job Search's or a Job Digest's results, the app's pages for them", () => {
    expect(pushLinkOf(tapped({ path: `/recherches/${ID}` }))).toBe("/recherches");
    expect(pushLinkOf(tapped({ path: `/job-digests/${ID}` }))).toBe("/job-digests");
  });

  it("reads the path from iOS' payload when the data does not carry it", () => {
    expect(pushLinkOf(tapped(null, { aps: {}, path: `/candidatures/${ID}` }))).toBe(`/candidatures/${ID}`);
  });

  it("opens nothing for what is not one of the app's pages: another site, an unknown page, an id that is not one", () => {
    for (const path of ["https://evil.example/candidatures/1", "//evil.example/", "/compte/supprimer", `/candidatures/${ID}/../../compte`, "/candidatures/a b", "/candidatures/", 42, undefined]) {
      expect(pushLinkOf(tapped({ path }))).toBeNull();
    }
    expect(pushLinkOf(null)).toBeNull();
    expect(pushLinkOf({})).toBeNull();
  });
});
