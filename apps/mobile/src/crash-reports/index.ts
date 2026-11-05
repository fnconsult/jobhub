// Crash reports (#703, ADR-0076): knowing when the app crashes without following anyone. Sentry, in its EU data region
// (events stored in Frankfurt), started only in release builds whose configuration carries the project's DSN; every
// event and breadcrumb cleaned on the device first (./clean). No product analytics and no advertising identifier: no
// sessions, tracing, replay or logs, and nothing that asks for App Tracking Transparency.
import type { ReactNativeOptions } from "@sentry/react-native";
import { cleanBreadcrumb, cleanEvent } from "./clean";

export type CrashReportOptions = ReactNativeOptions;

/** A DSN of Sentry's EU region: `https://<key>@<org>.ingest.de.sentry.io/<project>`. */
const EU_DSN = /^https:\/\/[^@/\s]+@(?:[a-z0-9-]+\.)*ingest\.de\.sentry\.io\/\d+$/i;

/**
 * Starts crash reports, once, at the app's launch; returns whether they were started. They are not in a development
 * build, nor without a DSN in the build's configuration, nor with a DSN outside Sentry's EU region.
 */
export function startCrashReports(
  config: { dsn: string | undefined; development: boolean },
  init: (options: CrashReportOptions) => unknown = sentryInit,
): boolean {
  const dsn = config.dsn?.trim();
  if (config.development || !dsn || !EU_DSN.test(dsn)) return false;
  init({
    dsn,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: false,
    enableLogs: false,
    enableCaptureFailedRequests: false,
    // iOS's native SDK records its own breadcrumb of each request, its URL whole; the JS ones are cleaned below.
    enableNetworkBreadcrumbs: false,
    beforeSend: cleanEvent,
    beforeBreadcrumb: cleanBreadcrumb,
  });
  return true;
}

/** Sentry's SDK, loaded only when crash reports start: a development build never runs any of it. */
function sentryInit(options: CrashReportOptions) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("@sentry/react-native") as typeof import("@sentry/react-native")).init(options);
}
