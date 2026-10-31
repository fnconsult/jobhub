import { describe, expect, it } from "vitest";
import { alertEmail, mimeOf } from "../../web/src/email-intake/fixtures/inbound-emails";
import { readInboundEmail } from "../../web/src/email-intake/inbound-email";
import * as appHeaders from "../../web/src/email-intake/inbound-headers";
import intake from "./intake.js";

const SECRET = "s".repeat(40);
const STAGING = { domain: "alertes.staging.jobbbox.ai", url: "http://jobbbox-staging-web:3000/api/email-intake/inbound", secret: SECRET };
const PRODUCTION = { domain: "alertes.jobbbox.ai", url: "http://jobbbox-production-web:3000/api/email-intake/inbound", secret: "p".repeat(40) };
const STAMP = "mx.jobbbox.ai;\r\n\tspf=pass smtp.mailfrom=alertes.cadremploi.fr;\r\n\tdkim=pass header.d=cadremploi.fr header.s=s1;\r\n\tdmarc=pass header.from=alertes.cadremploi.fr";

/** A fetch that answers `status` and keeps each request it was given. */
function app(status: number | ((url: string) => number) = 200) {
  const requests: Request[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    requests.push(request);
    return new Response("{}", { status: typeof status === "function" ? status(request.url) : status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

describe("the MTA's routes: which Email intake domain goes to which environment's app", () => {
  it("are read from INTAKE_ROUTE_<n>_DOMAIN, _URL and _SECRET, in order, domains in lower case", () => {
    const routes = intake.routesFromEnv({
      INTAKE_ROUTE_1_DOMAIN: "Alertes.Staging.Jobbbox.ai",
      INTAKE_ROUTE_1_URL: STAGING.url,
      INTAKE_ROUTE_1_SECRET: SECRET,
      INTAKE_ROUTE_2_DOMAIN: PRODUCTION.domain,
      INTAKE_ROUTE_2_URL: PRODUCTION.url,
      INTAKE_ROUTE_2_SECRET: PRODUCTION.secret,
    });

    expect(routes).toEqual([STAGING, PRODUCTION]);
  });

  it("refuse to start without a route, or with one missing its URL, an http(s) URL or a secret of 32 characters", () => {
    expect(() => intake.routesFromEnv({})).toThrow("INTAKE_ROUTE_1_DOMAIN");
    expect(() => intake.routesFromEnv({ INTAKE_ROUTE_1_DOMAIN: STAGING.domain, INTAKE_ROUTE_1_SECRET: SECRET })).toThrow("INTAKE_ROUTE_1_URL");
    expect(() => intake.routesFromEnv({ INTAKE_ROUTE_1_DOMAIN: STAGING.domain, INTAKE_ROUTE_1_URL: "ftp://web/x", INTAKE_ROUTE_1_SECRET: SECRET })).toThrow("INTAKE_ROUTE_1_URL");
    expect(() => intake.routesFromEnv({ INTAKE_ROUTE_1_DOMAIN: STAGING.domain, INTAKE_ROUTE_1_URL: STAGING.url, INTAKE_ROUTE_1_SECRET: "short" })).toThrow("INTAKE_ROUTE_1_SECRET");
  });

  it("take a recipient only on a route's own domain: no other domain, no subdomain, so the MTA relays nothing", () => {
    const routes = [STAGING, PRODUCTION];

    expect(intake.routeFor(routes, "k7d2m4q9x3b5n8ta@Alertes.Staging.Jobbbox.ai")).toEqual(STAGING);
    expect(intake.routeFor(routes, "k7d2m4q9x3b5n8ta@alertes.jobbbox.ai")).toEqual(PRODUCTION);
    expect(intake.routeFor(routes, "someone@gmail.com")).toBeNull();
    expect(intake.routeFor(routes, "x@sub.alertes.jobbbox.ai")).toBeNull();
    expect(intake.routeFor(routes, "x@jobbbox.ai")).toBeNull();
    expect(intake.routeFor(routes, "postmaster")).toBeNull();
  });
});

describe("delivering an accepted email to the app", () => {
  const message = Buffer.from(mimeOf(alertEmail("k7d2m4q9x3b5n8ta@alertes.staging.jobbbox.ai")));

  it("posts the raw message with its envelope, the MTA's stamp on one line and the route's secret: the app reads it as sent", async () => {
    const { requests, fetch } = app(200);

    const verdict = await intake.deliver({ routes: [STAGING], recipients: ["k7d2m4q9x3b5n8ta@alertes.staging.jobbbox.ai"], message, authenticationResults: STAMP, fetch });

    expect(verdict).toEqual({ verdict: "accepted" });
    const [request] = requests;
    expect(request!.url).toBe(STAGING.url);
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("x-inbound-secret")).toBe(SECRET);
    expect(request!.headers.get("content-type")).toBe("message/rfc822");
    const read = await readInboundEmail(request!);
    expect(read).toMatchObject({
      from: "offres@alertes.cadremploi.fr",
      recipients: ["k7d2m4q9x3b5n8ta@alertes.staging.jobbbox.ai"],
      authenticationResults: "mx.jobbbox.ai; spf=pass smtp.mailfrom=alertes.cadremploi.fr; dkim=pass header.d=cadremploi.fr header.s=s1; dmarc=pass header.from=alertes.cadremploi.fr",
    });
    expect(read!.text).toContain("Chef de projet digital H/F");
  });

  it("posts once per environment, each with its own recipients and secret", async () => {
    const { requests, fetch } = app(200);

    await intake.deliver({ routes: [STAGING, PRODUCTION], recipients: ["a@alertes.staging.jobbbox.ai", "b@alertes.jobbbox.ai", "c@alertes.staging.jobbbox.ai"], message, authenticationResults: STAMP, fetch });

    expect(requests.map((request) => [request.url, request.headers.get("x-envelope-to"), request.headers.get("x-inbound-secret")])).toEqual([
      [STAGING.url, "a@alertes.staging.jobbbox.ai,c@alertes.staging.jobbbox.ai", SECRET],
      [PRODUCTION.url, "b@alertes.jobbbox.ai", PRODUCTION.secret],
    ]);
  });

  it("names the headers as the app reads them (the image holds no app code, so the names are written twice)", () => {
    expect(intake.HEADERS).toEqual({
      secret: appHeaders.INBOUND_SECRET_HEADER,
      envelopeTo: appHeaders.ENVELOPE_TO_HEADER,
      authenticationResults: appHeaders.AUTHENTICATION_RESULTS_HEADER,
      contentType: appHeaders.RAW_MESSAGE_TYPE,
    });
  });

  it("defers the email (a temporary failure, so its sender retries) when the app fails, refuses the secret or cannot be reached", async () => {
    for (const status of [500, 502, 503, 401, 403]) {
      expect(await intake.deliver({ routes: [STAGING], recipients: ["a@alertes.staging.jobbbox.ai"], message, authenticationResults: STAMP, fetch: app(status).fetch })).toEqual({
        verdict: "deferred",
        detail: expect.stringContaining(String(status)),
      });
    }
    const unreachable = (async () => Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    expect(await intake.deliver({ routes: [STAGING], recipients: ["a@alertes.staging.jobbbox.ai"], message, authenticationResults: STAMP, fetch: unreachable })).toEqual({
      verdict: "deferred",
      detail: expect.stringContaining("fetch failed"),
    });
  });

  it("rejects the email for good when the app says it is not one, or too large", async () => {
    for (const status of [400, 413]) {
      expect(await intake.deliver({ routes: [STAGING], recipients: ["a@alertes.staging.jobbbox.ai"], message, authenticationResults: STAMP, fetch: app(status).fetch })).toEqual({
        verdict: "rejected",
        detail: expect.stringContaining(String(status)),
      });
    }
  });

  it("defers the whole email when one environment fails, though the other took it: delivered again, the other receives it once", async () => {
    const { fetch } = app((url) => (url === PRODUCTION.url ? 503 : 200));

    const verdict = await intake.deliver({ routes: [STAGING, PRODUCTION], recipients: ["a@alertes.staging.jobbbox.ai", "b@alertes.jobbbox.ai"], message, authenticationResults: STAMP, fetch });

    expect(verdict.verdict).toBe("deferred");
  });
});

describe("DMARC, as the MTA records it beside SPF and DKIM", () => {
  /** A resolver of TXT records from a table: an unknown name has none (ENOTFOUND). */
  const dns = (records: Record<string, string[]>) => async (name: string) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: "ENOTFOUND" });
    return found.map((record) => [record]);
  };
  const organisation = (domain: string) => domain.split(".").slice(-2).join(".");
  const evaluate = (input: { fromDomain: string; spf?: { result: string; domain: string } | null; dkim?: { result: string; domain: string }[] }, records: Record<string, string[]>) =>
    intake.dmarc({ spf: null, dkim: [], ...input, resolveTxt: dns(records), organizationalDomain: organisation });

  it("passes on DKIM aligned with the From domain's organisation, relaxed by default, the policy found on the organisation's record", async () => {
    const result = await evaluate({ fromDomain: "alertes.cadremploi.fr", dkim: [{ result: "pass", domain: "cadremploi.fr" }] }, { "_dmarc.cadremploi.fr": ["v=DMARC1; p=reject"] });

    expect(result).toBe("dmarc=pass (p=reject) header.from=alertes.cadremploi.fr");
  });

  it("passes on SPF aligned with it too", async () => {
    const result = await evaluate({ fromDomain: "linkedin.com", spf: { result: "pass", domain: "bounce.linkedin.com" } }, { "_dmarc.linkedin.com": ["v=DMARC1; p=quarantine"] });

    expect(result).toBe("dmarc=pass (p=quarantine) header.from=linkedin.com");
  });

  it("fails when what passed is another organisation's, or the alignment is strict and the domain not the same", async () => {
    expect(await evaluate({ fromDomain: "linkedin.com", dkim: [{ result: "pass", domain: "pirate.test" }], spf: { result: "pass", domain: "gmail.com" } }, { "_dmarc.linkedin.com": ["v=DMARC1; p=reject"] })).toBe(
      "dmarc=fail (p=reject) header.from=linkedin.com",
    );
    expect(await evaluate({ fromDomain: "alertes.cadremploi.fr", dkim: [{ result: "pass", domain: "cadremploi.fr" }] }, { "_dmarc.alertes.cadremploi.fr": ["v=DMARC1; p=none; adkim=s"] })).toBe(
      "dmarc=fail (p=none) header.from=alertes.cadremploi.fr",
    );
  });

  it("fails when nothing passed: a DKIM signature that failed, SPF softfail", async () => {
    const result = await evaluate(
      { fromDomain: "cadremploi.fr", dkim: [{ result: "fail", domain: "cadremploi.fr" }], spf: { result: "softfail", domain: "cadremploi.fr" } },
      { "_dmarc.cadremploi.fr": ["v=DMARC1; p=reject"] },
    );

    expect(result).toBe("dmarc=fail (p=reject) header.from=cadremploi.fr");
  });

  it("is none when the domain publishes no DMARC record, or not one that reads", async () => {
    expect(await evaluate({ fromDomain: "cabinet-fictif.test", dkim: [{ result: "pass", domain: "cabinet-fictif.test" }] }, {})).toBe("dmarc=none header.from=cabinet-fictif.test");
    expect(await evaluate({ fromDomain: "example.fr" }, { "_dmarc.example.fr": ["v=spf1 -all"] })).toBe("dmarc=none header.from=example.fr");
  });

  it("is temperror when DNS does not answer, so no one is recognised on a guess", async () => {
    const timeout = async () => Promise.reject(Object.assign(new Error("queryTxt ETIMEOUT"), { code: "ETIMEOUT" }));

    expect(await intake.dmarc({ fromDomain: "linkedin.com", spf: null, dkim: [{ result: "pass", domain: "linkedin.com" }], resolveTxt: timeout, organizationalDomain: organisation })).toBe(
      "dmarc=temperror header.from=linkedin.com",
    );
  });
});
