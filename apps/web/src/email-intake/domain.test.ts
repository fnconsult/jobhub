import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { emailIntakeDomain } from "./domain";

const setBy = { updatedBy: "ops@jobbbox.ai", updatedAt: new Date("2026-10-27T10:00:00Z") };

describe("the Email intake domain new Forwarding addresses are on (EMAIL_INTAKE_DOMAIN, #441)", () => {
  it("is alertes.jobbbox.ai while nothing sets it", () => {
    expect(emailIntakeDomain(snapshotOfSettings({}, {}))).toBe("alertes.jobbbox.ai");
  });

  it("is the Back Office's, over env's, in lower case", () => {
    expect(emailIntakeDomain(snapshotOfSettings({ EMAIL_INTAKE_DOMAIN: "alertes.example.test" }, { EMAIL_INTAKE_DOMAIN: { value: "Alertes.Staging.Jobbbox.ai", ...setBy } }))).toBe(
      "alertes.staging.jobbbox.ai",
    );
    expect(emailIntakeDomain(snapshotOfSettings({ EMAIL_INTAKE_DOMAIN: " alertes.example.test " }, {}))).toBe("alertes.example.test");
  });

  it("is the default when env's is not a domain name", () => {
    expect(emailIntakeDomain(snapshotOfSettings({ EMAIL_INTAKE_DOMAIN: "https://alertes.example.test" }, {}))).toBe("alertes.jobbbox.ai");
  });
});
