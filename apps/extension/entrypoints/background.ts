import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { readCandidateSession } from "../src/candidate-session";
import { createGuestSession } from "../src/guest-session";
import { createJobbboxApi } from "../src/jobbbox-api";
import type { AnalyseReply, ExtensionMessage } from "../src/messages";
import { WEB_ORIGIN } from "../src/web-app";

const EXPIRY_ALARM = "guest-session-expiry";

export default defineBackground(() => {
  const session = createGuestSession(browser.storage.session);
  const api = createJobbboxApi(WEB_ORIGIN);

  async function analyse(jobOffer: Extract<ExtensionMessage, { type: "analyse" }>["jobOffer"]): Promise<AnalyseReply> {
    const captured = await api.capture(jobOffer);
    if (!captured.ok) return captured;
    await session.keepJobOffer(captured.jobOffer);
    await browser.tabs.create({ url: browser.runtime.getURL("/analyse.html") });
    return { ok: true };
  }

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, reply) => {
    if (sender.id !== browser.runtime.id) return false;
    if (message.type === "analyse") {
      void analyse(message.jobOffer).then(reply);
      return true;
    }
    if (message.type === "interface-language") {
      void readCandidateSession(WEB_ORIGIN).then((current) => reply(current.signedIn ? current.candidate.interfaceLanguage : null));
      return true;
    }
    return false;
  });

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
