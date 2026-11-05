import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { exitDestination, exitHref, exitRedirectsBySelf, exitShellOf, exitSite, isExternalHref } from "./external-links";

describe("the Exit Page's links", () => {
  it("counts as external only an absolute http or https address", () => {
    expect(isExternalHref("https://www.welcometothejungle.com/fr/jobs/1")).toBe(true);
    expect(isExternalHref("http://example.com")).toBe(true);
    expect(isExternalHref("/candidatures/1")).toBe(false);
    expect(isExternalHref("#offre")).toBe(false);
    expect(isExternalHref("mailto:contact@jobbbox.ai")).toBe(false);
    expect(isExternalHref("tel:+33100000000")).toBe(false);
  });

  it("leads to the Exit Page of the shell the link is in", () => {
    const url = "https://example.com/offre?id=1&ref=jobbbox";
    expect(exitHref(url, "/candidatures/1")).toBe(`/sortie?url=${encodeURIComponent(url)}`);
    expect(exitHref(url, "/admin/coachs")).toBe(`/admin/sortie?url=${encodeURIComponent(url)}`);
    expect(exitHref(url, "/espace-coach")).toBe(`/espace-coach/sortie?url=${encodeURIComponent(url)}`);
    expect(exitShellOf("/administrateur")).toBe("site");
  });

  it("keeps a Visitor's English on the site's Exit Page, and leaves a link inside Jobbbox as it is", () => {
    expect(exitHref("https://example.com", "/en/aide", "en")).toBe("/sortie?url=https%3A%2F%2Fexample.com&lang=en");
    expect(exitHref("https://example.com", "/admin", "en")).toBe("/admin/sortie?url=https%3A%2F%2Fexample.com");
    expect(exitHref("/aide", "/", "en")).toBe("/aide");
  });

  it("takes a person only to one absolute web address, with no user name hiding its host", () => {
    expect(exitDestination("https://www.example.com/a?b=c")?.toString()).toBe("https://www.example.com/a?b=c");
    expect(exitDestination(undefined)).toBeNull();
    expect(exitDestination(["https://a.example", "https://b.example"])).toBeNull();
    expect(exitDestination("javascript:alert(1)")).toBeNull();
    expect(exitDestination("data:text/html,hi")).toBeNull();
    expect(exitDestination("//evil.example")).toBeNull();
    expect(exitDestination("/compte")).toBeNull();
    expect(exitDestination("https://jobbbox.ai@evil.example")).toBeNull();
    expect(exitDestination("https://")).toBeNull();
    expect(exitDestination(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });

  it("names the site without www.", () => {
    expect(exitSite(new URL("https://www.indeed.fr/viewjob?jk=1"))).toBe("indeed.fr");
    expect(exitSite(new URL("https://jobs.lever.co/acme"))).toBe("jobs.lever.co");
  });

  it("goes on by itself only for a person who came from a page of Jobbbox", () => {
    expect(exitRedirectsBySelf("https://jobbbox.ai/candidatures/1", "https://jobbbox.ai")).toBe(true);
    expect(exitRedirectsBySelf("https://evil.example/", "https://jobbbox.ai")).toBe(false);
    expect(exitRedirectsBySelf("", "https://jobbbox.ai")).toBe(false);
    expect(exitRedirectsBySelf("not a url", "https://jobbbox.ai")).toBe(false);
  });
});

describe("every link out of Jobbbox goes through the Exit Page", () => {
  const SRC = join(__dirname);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
    });

  it('has no <a target="_blank"> but a Legal Text of Jobbbox opened beside a form', () => {
    // The CGU and the CGV are pages of Jobbbox (/legal/…), opened in a new tab so the form keeps what was typed. Inside the
    // Jobbbox app's WebView, « Gérer mon abonnement sur jobbbox.ai » is Jobbbox's own subscription page in a new window,
    // which the app opens in the system's browser (#689).
    const allowed = new Set(["components/AcceptanceForm.tsx", "components/OrderForm.tsx", "app/abonnement/page.tsx"]);
    const offenders = files(SRC)
      .filter((path) => /<a\b[^>]*target="_blank"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
      .filter((path) => !allowed.has(path));
    expect(offenders).toEqual([]);
  });
});
