import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createAllSitesDetection } from "../src/all-sites-detection";
import { readCandidateSession } from "../src/candidate-session";
import { createGuestSession } from "../src/guest-session";
import { createJobbboxApi } from "../src/jobbbox-api";
import { createJobSites } from "../src/job-sites";
import type { ExtensionMessage } from "../src/messages";
import { createSidePanel } from "../src/side-panel";
import { WEB_ORIGIN } from "../src/web-app";

const EXPIRY_ALARM = "guest-session-expiry";

export default defineBackground(() => {
  const session = createGuestSession(browser.storage.session);
  const api = createJobbboxApi(WEB_ORIGIN);
  // The Job Sites set in the Back Office, for the badge (read from the web app, kept an hour).
  const jobSites = createJobSites({ origin: WEB_ORIGIN, fetch: (input, init) => fetch(input, init), storage: browser.storage.local });

  // The extension lives in the browser's Side Panel (ADR-0054): the toolbar icon and the badge open it.
  const sidePanel = createSidePanel({ sidePanel: browser.sidePanel, api, session });
  void sidePanel.openOnToolbarIcon().catch((error: unknown) => console.error("Jobbbox: the toolbar icon's Side Panel", error));

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, reply) => {
    if (sender.id !== browser.runtime.id) return false;
    if (message.type === "analyse") {
      // From the badge (a content script, in a tab), the panel opens beside it, in the person's click; from the panel, it is open.
      void sidePanel.capture(message.jobOffer, sender.tab).then(reply);
      return true;
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
