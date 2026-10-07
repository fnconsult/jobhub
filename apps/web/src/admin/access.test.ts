import { describe, expect, it } from "vitest";
import { administratorsFromEnv } from "./access";

describe("Administrators", () => {
  it("are the Jobbbox team members whose emails are listed in ADMIN_EMAILS, whatever the case", () => {
    const isAdministrator = administratorsFromEnv({ ADMIN_EMAILS: " claire@jobbbox.fr, Paul@Jobbbox.fr " });

    expect(isAdministrator({ email: "claire@jobbbox.fr", emailVerified: true })).toBe(true);
    expect(isAdministrator({ email: "paul@jobbbox.fr", emailVerified: true })).toBe(true);
    expect(isAdministrator({ email: "marie.dupont@example.fr", emailVerified: true })).toBe(false);
  });

  it("never include someone whose email address is not verified", () => {
    const isAdministrator = administratorsFromEnv({ ADMIN_EMAILS: "claire@jobbbox.fr" });

    expect(isAdministrator({ email: "claire@jobbbox.fr", emailVerified: false })).toBe(false);
  });

  it("are nobody when ADMIN_EMAILS is not set", () => {
    const isAdministrator = administratorsFromEnv({});

    expect(isAdministrator({ email: "", emailVerified: true })).toBe(false);
  });
});
