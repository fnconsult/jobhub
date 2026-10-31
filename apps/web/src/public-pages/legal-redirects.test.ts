import { describe, expect, it } from "vitest";
import { legalRedirect } from "./legal-redirects";

const at = (address: string) => {
  const url = new URL(address, "https://jobbbox.ai");
  return legalRedirect(url.pathname, url.searchParams);
};

describe("legalRedirect — where an address of Légal moved (ADR-0062, ADR-0064)", () => {
  it("leads « IA dans Jobbbox » to its section of the privacy policy", () => {
    expect(at("/legal/ia")).toBe("/legal/confidentialite#ia");
  });

  it("leads #470's addresses to the Legal Texts", () => {
    expect(at("/legal/conditions-utilisation")).toBe("/legal/cgu");
    expect(at("/legal/cookies")).toBe("/legal/confidentialite#cookies");
    expect(at("/legal/sous-traitants-et-ia")).toBe("/legal/confidentialite#ia");
  });

  it("leads ?version= to the dated address, keeping the page's language", () => {
    expect(at("/legal/cgu?version=2026-12-01")).toBe("/legal/cgu/2026-12-01");
    expect(at("/legal/conditions-utilisation?version=2026-12-01&lang=en")).toBe("/legal/cgu/2026-12-01?lang=en");
    expect(at("/legal/cookies?version=2026-12-01")).toBe("/legal/confidentialite/2026-12-01#cookies");
    expect(at("/legal/cookies?lang=en")).toBe("/legal/confidentialite?lang=en#cookies");
  });

  it("drops a ?version= that is no day: #470's numbered versions never had a text", () => {
    expect(at("/legal/confidentialite?version=3.2")).toBe("/legal/confidentialite");
  });

  it("leaves the Legal Texts' own addresses alone", () => {
    for (const address of ["/legal", "/legal/cgu", "/legal/cgu?lang=en", "/legal/cgu/2026-12-01", "/legal/cgu/versions", "/legal/blog", "/nouveautes?version=1"])
      expect(at(address), address).toBeNull();
  });
});
