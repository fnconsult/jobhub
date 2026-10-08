import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import { browser } from "wxt/browser";
import { ALL_SITES } from "../../src/all-sites-detection";
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

/** The Job Offer the page in a tab describes, read in the person's own browser (ADR-0002). */
async function readTab(tabId: number): Promise<CapturedJobOffer | null> {
  // On job sites, the badge content script is already there.
  const fromContentScript = await browser.tabs
    .sendMessage<ExtensionMessage, CapturedJobOffer | null>(tabId, { type: "capture" })
    .catch(() => undefined);
  if (fromContentScript !== undefined) return fromContentScript;
  // Anywhere else, the person's click on the toolbar button grants activeTab for this page.
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, files: ["/capture.js"] });
    return (injection?.result as CapturedJobOffer | null | undefined) ?? null;
  } catch {
    return null; // Browser pages, extension stores and the like cannot be read.
  }
}

/** Manual Capture of the page in the active tab, on any site. */
async function captureActiveTab(): Promise<AnalyseReply | { ok: false; error: "impossible" }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const jobOffer = tab?.id === undefined ? null : await readTab(tab.id);
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

/**
 * The badge on every site, for employers' own career sites: off by default, so
 * the extension reads no other site until the person grants it, here.
 */
async function allSitesOption(): Promise<HTMLElement> {
  const option = element("div", "", "option");
  const input = document.createElement("input");
  Object.assign(input, { type: "checkbox", id: "all-sites", checked: await browser.permissions.contains({ origins: [...ALL_SITES] }) });
  input.setAttribute("aria-describedby", "all-sites-hint");
  const label = element("label", t("extension.allSites")) as HTMLLabelElement;
  label.htmlFor = "all-sites";
  const hint = element("p", t("extension.allSitesHint"), "hint");
  hint.id = "all-sites-hint";
  input.addEventListener("change", async () => {
    const permissions = { origins: [...ALL_SITES] };
    // The background registers or removes the badge when the permission changes.
    const granted = input.checked
      ? await browser.permissions.request(permissions).catch(() => false)
      : !(await browser.permissions.remove(permissions).catch(() => false));
    input.checked = granted;
  });
  const row = element("div", "", "checkbox");
  row.append(input, label);
  option.append(row, hint);
  return option;
}

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
    await allSitesOption(),
    ...account,
  );
