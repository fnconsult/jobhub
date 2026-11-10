import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createAllSitesDetection } from "../src/all-sites-detection";
import { createErrorReports, readErrorReport, type ErrorPlace } from "../src/error-reports";
import { readCandidateSession } from "../src/candidate-session";
import { createExtensionUpdate } from "../src/extension-update";
import { createGuestSession } from "../src/guest-session";
import { createJobbboxApi } from "../src/jobbbox-api";
import { createJobSites } from "../src/job-sites";
import type { ExtensionMessage } from "../src/messages";
import { createSidePanel } from "../src/side-panel";
import { WEB_ORIGIN } from "../src/web-app";

const EXPIRY_ALARM = "guest-session-expiry";

export default defineBackground(() => {
  const session = createGuestSession(browser.storage.session);
  // The errors reported to Jobbbox (#924): the content script's, and the Captures' failed calls, by where they were asked.
  const errorReports = createErrorReports(WEB_ORIGIN);
  const update = createExtensionUpdate(browser.storage.local);
  // A Capture the web app refuses as from an outdated extension (#564) asks for the update, which the Side Panel shows.
  const apiFor = (place: ErrorPlace) =>
    createJobbboxApi(WEB_ORIGIN, undefined, update, ({ route, httpStatus }) => errorReports.report({ errorCode: "callFailed", route, httpStatus, place }));
  // The Job Sites set in the Back Office, for the badge (read from the web app, kept an hour).
  const jobSites = createJobSites({ origin: WEB_ORIGIN, fetch: (input, init) => fetch(input, init), storage: browser.storage.local });

  // The extension lives in the browser's Side Panel (ADR-0054): the toolbar icon and the badge open it.
  // A Capture from the badge (in a tab) or from the panel: the same, but for where a failed call is said to happen.
  const sidePanel = createSidePanel({ sidePanel: browser.sidePanel, api: apiFor("side_panel"), session });
  const fromBadge = createSidePanel({ sidePanel: browser.sidePanel, api: apiFor("page_button"), session });
  void sidePanel.openOnToolbarIcon().catch((error: unknown) => console.error("Jobbbox: the toolbar icon's Side Panel", error));

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, reply) => {
    if (sender.id !== browser.runtime.id) return false;
    if (message.type === "analyse") {
      // From the badge (a content script, in a tab), the panel opens beside it, in the person's click; from the panel, it is open.
      void (sender.tab ? fromBadge : sidePanel).capture(message.jobOffer, sender.tab).then(reply);
      return true;
    }
    if (message.type === "report-error") {
      // Only from the badge's content script, which may say no more than its own two places.
      const report = readErrorReport(message.report);
      if (report && sender.tab && report.place !== "side_panel") errorReports.report(report);
      return false;
    }
    if (message.type === "job-sites") {
      void jobSites.current().then(reply);
      return true;
    }
    if (message.type === "interface-language") {
      void readCandidateSession(WEB_ORIGIN).then((current) => reply(current.signedIn ? current.candidate.interfaceLanguage : null));
      return true;
    }
    return false;
  });

  // The badge on every site, exactly while the person grants it (from the Side Panel).
  const allSites = createAllSitesDetection({ permissions: browser.permissions, scripting: browser.scripting });
  const syncAllSites = () => void allSites.sync().catch((error: unknown) => console.error("Jobbbox: badge on every site", error));
  syncAllSites();
  browser.permissions.onAdded.addListener(syncAllSites);
  browser.permissions.onRemoved.addListener(syncAllSites);

  // Forget the Guest session when it expires, even if nothing reads it again (ADR-0003).
  browser.storage.session.onChanged.addListener(() => {
    void session.read().then(({ expiresAt }) => {
      if (expiresAt) void browser.alarms.create(EXPIRY_ALARM, { when: expiresAt });
      else void browser.alarms.clear(EXPIRY_ALARM);
    });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === EXPIRY_ALARM) void session.read();
  });
});
