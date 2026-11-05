// Crash reports (#703, ADR-0076): Sentry in its EU region, started only in release builds, and every event and
// breadcrumb cleaned of personal data before it leaves the device. Tested through what the app hands to Sentry.
import type { Breadcrumb, ErrorEvent } from "@sentry/react-native";
import { startCrashReports, type CrashReportOptions } from "./index";

const EU_DSN = "https://0123456789abcdef@o4500000000000000.ingest.de.sentry.io/4500000000000001";
const ID = "3f2c8a1e-9b7d-4c6e-8f10-2a3b4c5d6e7f";

/** Starts crash reports as a release build would, and returns the options Sentry was started with. */
function started(dsn: string | undefined = EU_DSN): CrashReportOptions {
  const init = jest.fn();
  expect(startCrashReports({ dsn, development: false }, init)).toBe(true);
  return init.mock.calls[0][0];
}

describe("Starting crash reports", () => {
  it("starts Sentry with the configured EU DSN, without personal data, screenshots or a view of the screen", () => {
    const options = started();
    expect(options.dsn).toBe(EU_DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
  });

  it("measures nothing of how the app is used: no sessions, no performance tracing, no replay, no logs", () => {
    const options = started();
    expect(options.enableAutoSessionTracking).toBe(false);
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
    expect(options.enableLogs).toBe(false);
    expect(options.enableCaptureFailedRequests).toBe(false);
  });

  it("leaves out iOS's own network breadcrumbs, whose URLs the app cannot clean", () => {
    expect(started().enableNetworkBreadcrumbs).toBe(false);
  });

  it("does not start in a development build", () => {
    const init = jest.fn();
    expect(startCrashReports({ dsn: EU_DSN, development: true }, init)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("does not start without a DSN in the build's configuration", () => {
    const init = jest.fn();
    expect(startCrashReports({ dsn: undefined, development: false }, init)).toBe(false);
    expect(startCrashReports({ dsn: "  ", development: false }, init)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("does not start with a DSN outside Sentry's EU region", () => {
    const init = jest.fn();
    expect(startCrashReports({ dsn: "https://0123456789abcdef@o45.ingest.us.sentry.io/45", development: false }, init)).toBe(false);
    expect(startCrashReports({ dsn: "https://0123456789abcdef@o45.ingest.sentry.io/45", development: false }, init)).toBe(false);
    expect(startCrashReports({ dsn: "https://key@evil.example/ingest.de.sentry.io/45", development: false }, init)).toBe(false);
    expect(startCrashReports({ dsn: "not a dsn", development: false }, init)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});

describe("Cleaning an event", () => {
  const clean = (event: ErrorEvent) => started().beforeSend!(event, {}) as ErrorEvent;

  it("removes the user, the request body, cookies and headers, and identifiers from the API's URLs", () => {
    const event: ErrorEvent = {
      type: undefined,
      event_id: "abc",
      user: { id: "user-42", email: "jeanne.martin@example.com", ip_address: "203.0.113.7", username: "jeanne" },
      request: {
        url: `https://user:secret@app.jobbbox.ai/api/applications/${ID}/interviews?token=abc#notes`,
        method: "POST",
        data: { message: "Je cherche un poste de cheffe de projet" },
        cookies: { session: "s3cr3t" },
        headers: { Authorization: "Bearer s3cr3t" },
        query_string: "token=abc",
        env: { REMOTE_ADDR: "203.0.113.7" },
      },
      contexts: {
        device: { id: "android-installation-id", name: "iPhone de Jeanne", model: "iPhone15,2", family: "iOS" },
        app: { app_version: "1.0.0", device_app_hash: "a1b2c3" },
        os: { name: "iOS", version: "18.0" },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: `No profile for jeanne.martin@example.com at https://app.jobbbox.ai/api/profiles/${ID}?email=jeanne.martin@example.com`,
          },
        ],
      },
      message: "Failed for jeanne.martin@example.com",
      breadcrumbs: [
        { category: "touch", message: "Touch event within element: Envoyer", data: { path: [{ name: "TextInput", label: "Je cherche" }] } },
        { category: "console", level: "log", message: "draft: Je cherche un poste" },
        { category: "fetch", type: "http", data: { method: "GET", url: `https://app.jobbbox.ai/api/applications/${ID}`, status_code: 500 } },
      ],
    };

    const cleaned = clean(event);

    expect(cleaned.user).toBeUndefined();
    expect(cleaned.request).toEqual({ method: "POST", url: "https://app.jobbbox.ai/api/applications/:id/interviews" });
    expect(cleaned.contexts?.device).toEqual({ model: "iPhone15,2", family: "iOS" });
    expect(cleaned.contexts?.app).toEqual({ app_version: "1.0.0" });
    expect(cleaned.contexts?.os).toEqual({ name: "iOS", version: "18.0" });
    expect(cleaned.exception?.values?.[0]?.value).toBe("No profile for [email] at https://app.jobbbox.ai/api/profiles/:id");
    expect(cleaned.message).toBe("Failed for [email]");
    expect(cleaned.breadcrumbs).toEqual([
      { category: "fetch", type: "http", data: { method: "GET", url: "https://app.jobbbox.ai/api/applications/:id", status_code: 500 } },
    ]);
    expect(JSON.stringify(cleaned)).not.toMatch(/jeanne|Jeanne|s3cr3t|secret|203\.0\.113\.7|Je cherche|token=|3f2c8a1e/);
  });

  it("keeps what tells a crash apart: its type, stack, release and the device's model", () => {
    const event: ErrorEvent = {
      type: undefined,
      release: "ai.jobbbox.app@1.0.0+1",
      exception: { values: [{ type: "TypeError", value: "undefined is not a function", stacktrace: { frames: [{ function: "send", lineno: 12 }] } }] },
      contexts: { device: { model: "Pixel 8" } },
    };
    expect(clean(event)).toEqual(event);
  });
});

describe("Cleaning a breadcrumb", () => {
  const clean = (breadcrumb: Breadcrumb) => started().beforeBreadcrumb!(breadcrumb, undefined);

  it("drops touches, interface events and console lines, which can carry what a person typed", () => {
    expect(clean({ category: "touch", message: "Touch event within element: Envoyer" })).toBeNull();
    expect(clean({ category: "ui.click", message: "View > TextInput" })).toBeNull();
    expect(clean({ category: "ui.input", message: "Je cherche" })).toBeNull();
    expect(clean({ category: "console", message: "draft: Je cherche" })).toBeNull();
  });

  it("keeps only the method, status and cleaned URL of an API call, never its body", () => {
    expect(
      clean({
        category: "xhr",
        type: "http",
        data: { method: "PUT", url: `https://app.jobbbox.ai/api/profiles/${ID}?draft=1`, status_code: 200, request_body: "{\"name\":\"Jeanne\"}", response_body_size: 120 },
      }),
    ).toEqual({ category: "xhr", type: "http", data: { method: "PUT", url: "https://app.jobbbox.ai/api/profiles/:id", status_code: 200 } });
  });

  it("keeps a page change with its route, identifiers removed, and without its parameters", () => {
    expect(
      clean({ category: "navigation", data: { from: "/candidatures", to: `/conversations/${ID}`, params: { id: ID, q: "cheffe de projet" } } }),
    ).toEqual({ category: "navigation", data: { from: "/candidatures", to: "/conversations/:id" } });
  });

  it("cleans a deep link's URL", () => {
    expect(clean({ category: "deeplink", data: { url: `jobbbox://candidatures/${ID}?invite=abc` } })).toEqual({
      category: "deeplink",
      data: { url: "jobbbox://candidatures/:id" },
    });
  });

  it("keeps the app's own lifecycle breadcrumbs as they are", () => {
    const breadcrumb = { category: "app.lifecycle", message: "background" };
    expect(clean(breadcrumb)).toEqual(breadcrumb);
  });
});
