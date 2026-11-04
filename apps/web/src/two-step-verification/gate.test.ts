import { SECOND_STEP_PATH } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { pendingSessionGate, secondStepHref, SECOND_STEP_ENDPOINT, SECOND_STEP_PAGE, SECOND_STEP_PASSKEY_ENDPOINT, SETUP_ENDPOINT } from "./gate";

describe("what a session pending its second step reaches (ADR-0075)", () => {
  it("is the page the extension links to", () => {
    expect(SECOND_STEP_PAGE).toBe(SECOND_STEP_PATH);
  });

  it("reaches the second step's page and endpoint, and sign-out", () => {
    expect(pendingSessionGate(SECOND_STEP_PAGE, "GET")).toBe("open");
    expect(pendingSessionGate(`${SECOND_STEP_PAGE}?suite=%2Fcompte`, "GET")).toBe("open");
    expect(pendingSessionGate(SECOND_STEP_ENDPOINT, "POST")).toBe("open");
    expect(pendingSessionGate("/api/auth/sign-out", "POST")).toBe("open");
  });

  it("reaches the second step with a passkey, never Better Auth's passkey endpoints (#664)", () => {
    expect(pendingSessionGate(SECOND_STEP_PASSKEY_ENDPOINT, "POST")).toBe("open");
    for (const endpoint of ["generate-register-options", "verify-registration", "list-user-passkeys", "update-passkey", "verify-authentication"]) {
      expect(pendingSessionGate(`/api/auth/passkey/${endpoint}`, "POST"), endpoint).toBe("refuse");
    }
  });

  it("reaches the endpoint that sets up an authenticator app, for an account that must have it and has no factor yet (#665)", () => {
    expect(SETUP_ENDPOINT).toBe("/api/two-step-verification/setup");
    expect(pendingSessionGate(SETUP_ENDPOINT, "POST")).toBe("open");
    expect(pendingSessionGate(SETUP_ENDPOINT, "PUT")).toBe("open");
    expect(pendingSessionGate("/api/account/two-step-verification", "POST")).toBe("refuse");
  });

  it("is sent to the second step from any other page", () => {
    for (const page of ["/", "/compte", "/compte/donnees", "/acceptation", "/connexion", "/legal/cgu", "/en/legal/cgu", "/admin"]) {
      expect(pendingSessionGate(page, "GET"), page).toBe("redirect");
    }
  });

  it("is refused by every other API route, Better Auth's included, and by a Server Action posted to a page", () => {
    for (const path of ["/api/profiles", "/api/account/export", "/api/auth/get-session", "/api/auth/update-user", "/api/agenda/interview/1/calendar.ics", "/api/health"]) {
      expect(pendingSessionGate(path, "GET"), path).toBe("refuse");
    }
    expect(pendingSessionGate("/compte/preferences", "POST")).toBe("refuse");
    expect(pendingSessionGate(SECOND_STEP_ENDPOINT.replace("second-step", "other"), "POST")).toBe("refuse");
  });

  it.each([
    "/api/applications",
    "/api/applications/0c7c2a49-3b7a-4c6e-9f5e-1d2a3b4c5d6e",
    "/api/applications/0c7c2a49-3b7a-4c6e-9f5e-1d2a3b4c5d6e/documents",
    "/api/job-searches",
    "/api/job-searches/0c7c2a49-3b7a-4c6e-9f5e-1d2a3b4c5d6e",
    "/api/job-digests",
    "/api/agenda?periode=passes",
    "/api/coaching",
    "/api/profiles",
    "/api/profiles/0c7c2a49-3b7a-4c6e-9f5e-1d2a3b4c5d6e",
    "/api/coach/conversations?free=1",
    "/api/coach/conversations?kind=menu&id=agenda",
  ])("refuses the Jobbbox app's read %s with second_step_required (#684)", (path) => {
    expect(pendingSessionGate(path, "GET")).toBe("refuse");
  });

  it("still loads what the second step's page is drawn with: Next's files, the logos", () => {
    expect(pendingSessionGate("/_next/static/chunks/app.js", "GET")).toBe("open");
    expect(pendingSessionGate("/logos/jobbbox.svg", "GET")).toBe("open");
    expect(pendingSessionGate("/robots.txt", "GET")).toBe("open");
  });

  it("sends a page back where it was asked once the second step is done", () => {
    expect(secondStepHref("/compte/preferences?x=1")).toBe(`${SECOND_STEP_PAGE}?suite=%2Fcompte%2Fpreferences%3Fx%3D1`);
    expect(secondStepHref("/")).toBe(SECOND_STEP_PAGE);
    expect(secondStepHref("//evil.example")).toBe(SECOND_STEP_PAGE);
  });
});
