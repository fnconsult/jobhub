import { describe, expect, it } from "vitest";
import { snapshotOfSettings, type StoredPlatformSettings } from "../platform-settings/resolver";
import { maintenanceOf, maintenanceResponse, retryAfterSeconds, staysOpen } from "./index";

const ON_AT = new Date("2026-10-30T13:00:00Z");
const stored = (values: Record<string, string>): StoredPlatformSettings =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, updatedBy: "ops@jobbbox.ai", updatedAt: ON_AT }]));

describe("maintenance, as Paramètres sets it", () => {
  it("is off by default", () => {
    expect(maintenanceOf(snapshotOfSettings({}, {}))).toBeNull();
  });

  it("is on with its messages, and ends when switched on plus the expected minutes", () => {
    const maintenance = maintenanceOf(snapshotOfSettings({}, stored({ MAINTENANCE_MODE: "true", MAINTENANCE_MESSAGE_FR: " Mise à jour. ", MAINTENANCE_EXPECTED_MINUTES: "45" })));
    expect(maintenance).toEqual({ message: { fr: "Mise à jour.", en: "" }, returnsAt: new Date("2026-10-30T13:45:00Z") });
  });

  it("has no return time when switched on from env, or with 0 minutes", () => {
    expect(maintenanceOf(snapshotOfSettings({ MAINTENANCE_MODE: "true" }, {}))?.returnsAt).toBeNull();
    expect(maintenanceOf(snapshotOfSettings({}, stored({ MAINTENANCE_MODE: "true", MAINTENANCE_EXPECTED_MINUTES: "0" })))?.returnsAt).toBeNull();
  });
});

describe("what stays open during maintenance", () => {
  it.each(["/admin", "/admin/parametres", "/api/admin/settings", "/api/auth/sign-in", "/api/health", "/api/billing/webhook", "/api/email-intake/inbound", "/_next/data/x.json"])("%s stays open", (path) => {
    expect(staysOpen(path)).toBe(true);
  });

  it.each(["/", "/compte", "/connexion", "/api/profiles", "/administrateur", "/api/billing/checkout"])("%s answers 503", (path) => {
    expect(staysOpen(path)).toBe(false);
  });
});

describe("the 503 answer", () => {
  const maintenance = { message: { fr: "Nouvelle version <b>", en: "New version" }, returnsAt: new Date("2026-10-30T13:45:00Z") };

  it("asks to retry when it should end, at least a minute, ten minutes when unknown", () => {
    expect(retryAfterSeconds(maintenance, new Date("2026-10-30T13:15:00Z"))).toBe(1800);
    expect(retryAfterSeconds(maintenance, new Date("2026-10-30T14:00:00Z"))).toBe(60);
    expect(retryAfterSeconds({ ...maintenance, returnsAt: null }, ON_AT)).toBe(600);
  });

  it("is a bilingual page, French first, never cached nor indexed, its message escaped", async () => {
    const response = maintenanceResponse(maintenance, "/compte", new Date("2026-10-30T13:15:00Z"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1800");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html.indexOf('lang="fr"')).toBeLessThan(html.indexOf('<section lang="en"'));
    expect(html).toContain("Retour prévu vers 14:45.");
    expect(html).toContain("Nouvelle version &#60;b&#62;");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/>J</);
  });

  it("is JSON under /api", async () => {
    const response = maintenanceResponse(maintenance, "/api/profiles", ON_AT);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "maintenance", returnsAt: "2026-10-30T13:45:00.000Z" });
  });
});
