import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { emailIntakeDomain, emailIntakeLimits } from "./domain";

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

describe("Email intake's limits (#442)", () => {
  it("are 50 emails read a day per Linked mailbox, « filtre trop large » from 20, and Brevo's two webhook IP ranges, while nothing sets them", () => {
    expect(emailIntakeLimits(snapshotOfSettings({}, {}))).toEqual({ dailyCap: 50, broadFilterThreshold: 20, brevoIpRanges: ["1.179.112.0/20", "172.246.240.0/20"] });
  });

  it("are the Back Office's, over env's", () => {
    const limits = emailIntakeLimits(
      snapshotOfSettings(
        { EMAIL_INTAKE_DAILY_CAP: "80", EMAIL_INTAKE_BREVO_IP_RANGES: "127.0.0.1/32, ::1" },
        { EMAIL_INTAKE_DAILY_CAP: { value: "30", ...setBy }, EMAIL_INTAKE_BROAD_FILTER_THRESHOLD: { value: "12", ...setBy } },
      ),
    );

    expect(limits).toEqual({ dailyCap: 30, broadFilterThreshold: 12, brevoIpRanges: ["127.0.0.1/32", "::1"] });
  });

  it("keep the defaults for a value that does not read: a cap out of bounds, IP ranges with none that reads", () => {
    const limits = emailIntakeLimits(snapshotOfSettings({ EMAIL_INTAKE_DAILY_CAP: "0", EMAIL_INTAKE_BREVO_IP_RANGES: "brevo, partout" }, {}));

    expect(limits.dailyCap).toBe(50);
    expect(limits.brevoIpRanges).toEqual(["1.179.112.0/20", "172.246.240.0/20"]);
  });
});
