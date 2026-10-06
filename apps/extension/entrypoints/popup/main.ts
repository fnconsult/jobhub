import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import { readCandidateSession } from "../../src/candidate-session";
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

const account = session.signedIn
  ? [element("p", t("extension.signedInAs", { email: session.candidate.email })), link(t("extension.account"), "/compte")]
  : [element("p", t("extension.signedOut")), link(t("extension.signIn"), "/connexion")];

document
  .querySelector("#app")
  ?.append(
    element("h1", t("extension.title")),
    element("p", t("extension.description")),
    element("p", t("extension.comingSoon"), "notice"),
    ...account,
  );
