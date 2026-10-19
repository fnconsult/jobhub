import { describe, expect, it } from "vitest";
import { isForbiddenSite, jobDiscoveryDomain, jobSitePattern } from "./search-sites";

describe("a Job discovery site's domain", () => {
  it.each([
    ["apec.fr", "apec.fr"],
    [" WWW.Apec.fr ", "apec.fr"],
    ["https://www.cadremploi.fr/emploi/liste_offres?x=1", "cadremploi.fr"],
    ["candidat.francetravail.fr", "candidat.francetravail.fr"],
    ["jobs.example.co.uk.", "jobs.example.co.uk"],
  ])("reads %j as %s", (input, domain) => {
    expect(jobDiscoveryDomain(input)).toBe(domain);
  });

  it.each(["", "apec", "*.apec.fr", "apec.fr/emploi", "https://apec.fr:8443/", "ftp://apec.fr", "-apec.fr", "apec..fr", "127.0.0.1", `${"a".repeat(250)}.fr`, 3])(
    "refuses %j",
    (input) => {
      expect(jobDiscoveryDomain(input)).toBeNull();
    },
  );
});

describe("a forbidden site", () => {
  it("covers its subdomains and its www. address, never a domain merely ending the same way", () => {
    expect(isForbiddenSite("fr.linkedin.com")).toBe(true);
    expect(isForbiddenSite("www.indeed.fr")).toBe(true);
    expect(isForbiddenSite("notlinkedin.com")).toBe(false);
  });
});

describe("a Job Site's match pattern", () => {
  it.each([
    ["https://*.gestmax.fr/*", "https://*.gestmax.fr/*"],
    ["*.Gestmax.fr", "https://*.gestmax.fr/*"],
    ["www.apec.fr", "https://www.apec.fr/*"],
    ["https://jobs.example.fr/offres/*", "https://jobs.example.fr/offres/*"],
  ])("reads %j as %s", (input, pattern) => {
    expect(jobSitePattern(input)).toBe(pattern);
  });

  it.each(["https://*/*", "*://example.fr/*", "<all_urls>", "http://example.fr/*", "https://exa*mple.fr/*", "https://example.fr:443/*", "https://example.fr/ *", "https://localhost/*", null])(
    "refuses %j",
    (input) => {
      expect(jobSitePattern(input)).toBeNull();
    },
  );
});
