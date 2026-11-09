import { describe, expect, it } from "vitest";
import { createErrorReports, ERROR_REPORTS_PATH, pageDomainOf, readErrorReport } from "./error-reports";
import { EXTENSION_VERSION } from "./extension-update";

const WEB_ORIGIN = "https://app.jobbbox.fr";

function webApp(reply: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return reply();
    },
  };
}

describe("the errors the extension reports to Jobbbox (#924)", () => {
  it("sends one to the web app, with the browser's session, its API and Extension Versions", async () => {
    const app = webApp();

    createErrorReports(WEB_ORIGIN, app.fetch).report({ errorCode: "captureImpossible", messageKey: "extension.captureImpossible", place: "side_panel", pageDomain: "www.indeed.fr" });

    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.url).toBe(`${WEB_ORIGIN}${ERROR_REPORTS_PATH}`);
    expect(app.calls[0]!.init).toMatchObject({ method: "POST", credentials: "include" });
    expect(new Headers(app.calls[0]!.init.headers).get("Jobbbox-Extension-Version")).toBe(EXTENSION_VERSION);
    expect(JSON.parse(String(app.calls[0]!.init.body))).toEqual({ errorCode: "captureImpossible", messageKey: "extension.captureImpossible", place: "side_panel", pageDomain: "www.indeed.fr" });
  });

  it("sends it at best: never throws, never waits, never tries again when it fails", async () => {
    const app = webApp(() => Promise.reject(new TypeError("Failed to fetch")));
    const reports = createErrorReports(WEB_ORIGIN, app.fetch);

    expect(() => reports.report({ errorCode: "unexpected", place: "content_script" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.calls).toHaveLength(1);
  });

  it("sends the page's domain alone, never its address", () => {
    expect(pageDomainOf("https://www.welcometothejungle.com/fr/companies/x/jobs/y?email=marie.dupont@example.fr#top")).toBe("www.welcometothejungle.com");
    expect(pageDomainOf("http://Emploi.Example.FR:8080/offre")).toBe("emploi.example.fr");
    expect(pageDomainOf("chrome://extensions")).toBeUndefined();
    expect(pageDomainOf("file:///Users/marie/cv.pdf")).toBeUndefined();
    expect(pageDomainOf("pas une adresse")).toBeUndefined();
    expect(pageDomainOf(undefined)).toBeUndefined();
  });

  it("reads a report sent by a content script as one, and nothing else (the background forwards it)", () => {
    expect(readErrorReport({ errorCode: "captureImpossible", place: "page_button", pageDomain: "www.indeed.fr", url: "https://www.indeed.fr/x" })).toEqual({
      errorCode: "captureImpossible",
      place: "page_button",
      pageDomain: "www.indeed.fr",
    });
    expect(readErrorReport({ errorCode: "callFailed", route: "/api/job-offers", httpStatus: 500, place: "side_panel" })).toEqual({
      errorCode: "callFailed",
      route: "/api/job-offers",
      httpStatus: 500,
      place: "side_panel",
    });
    expect(readErrorReport({ errorCode: "captureImpossible", place: "toolbar" })).toBeNull();
    expect(readErrorReport({ place: "side_panel" })).toBeNull();
    expect(readErrorReport(null)).toBeNull();
  });
});
