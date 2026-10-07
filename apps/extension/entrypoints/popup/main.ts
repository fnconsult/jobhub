import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import { browser } from "wxt/browser";
import { readCandidateSession } from "../../src/candidate-session";
import type { CapturedJobOffer } from "../../src/job-page";
import type { AnalyseReply, ExtensionMessage } from "../../src/messages";
import { WEB_ORIGIN } from "../../src/web-app";
import "./popup.css";

const style = document.createElement("style");
style.textContent = renderDesignCss(designTokens);
document.head.append(style);

function element(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text: string, path: string): HTMLElement {
  const anchor = element("a", text) as HTMLAnchorElement;
  anchor.href = `${WEB_ORIGIN}${path}`;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
}

// The popup shares the web app's session (and so the Candidate's Interface Language).
const session = await readCandidateSession(WEB_ORIGIN);
const i18n = createI18n(session.signedIn ? session.candidate.interfaceLanguage : undefined);
const { t } = i18n;

document.documentElement.lang = i18n.language;
document.title = t("extension.title");

/**
 * Manual Capture of the page in the active tab, on any site: the person's click
 * grants activeTab, so the page is read in their own browser (ADR-0002).
 */
async function captureActiveTab(): Promise<AnalyseReply | { ok: false; error: "impossible" }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let jobOffer: CapturedJobOffer | null = null;
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId: tab!.id! }, files: ["/capture.js"] });
    jobOffer = (injection?.result as CapturedJobOffer | null | undefined) ?? null;
  } catch {
    // Browser pages, extension stores and the like cannot be read.
  }
  if (!jobOffer) return { ok: false, error: "impossible" };
  return browser.runtime.sendMessage<ExtensionMessage, AnalyseReply>({ type: "analyse", jobOffer });
}

const capture = element("button", t("extension.capturePage"), "primary") as HTMLButtonElement;
const captureStatus = element("p", "", "status");
captureStatus.setAttribute("role", "status");
capture.addEventListener("click", async () => {
  capture.disabled = true;
  captureStatus.textContent = t("extension.capturing");
  const reply = await captureActiveTab().catch((): AnalyseReply => ({ ok: false, error: "unreachable" }));
  capture.disabled = false;
  if (reply.ok) return window.close();
  captureStatus.textContent = t(reply.error === "unreachable" ? "extension.unreachable" : "extension.captureImpossible");
});

const account = session.signedIn
  ? [element("p", t("extension.signedInAs", { email: session.candidate.email })), link(t("extension.account"), "/compte")]
  : [element("p", t("extension.signedOut")), link(t("extension.signIn"), "/connexion")];

document
  .querySelector("#app")
  ?.append(
    element("h1", t("extension.title")),
    element("p", t("extension.description")),
    capture,
    captureStatus,
    ...account,
  );
