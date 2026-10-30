import { describe, expect, it } from "vitest";
import { responseNotice, retryAfterSeconds } from "./ResponseWatcher";

describe("what the page says of an answer from our API", () => {
  it("says the session expired on a 401, to someone signed in only", () => {
    expect(responseNotice(401, null, true)).toEqual({ kind: "sessionExpired" });
    expect(responseNotice(401, null, false)).toBeNull();
  });

  it("says when to try again on a 429", () => {
    expect(responseNotice(429, "30", false)).toEqual({ kind: "tooManyRequests", seconds: 30 });
    expect(responseNotice(429, null, true)).toEqual({ kind: "tooManyRequests", seconds: null });
  });

  it("says nothing of the rest", () => {
    expect(responseNotice(200, null, true)).toBeNull();
    expect(responseNotice(404, null, true)).toBeNull();
  });

  it("reads Retry-After as seconds or as a date", () => {
    expect(retryAfterSeconds("120")).toBe(120);
    expect(retryAfterSeconds("Fri, 30 Oct 2026 13:01:00 GMT", Date.parse("2026-10-30T13:00:00Z"))).toBe(60);
    expect(retryAfterSeconds("soon")).toBeNull();
  });
});
