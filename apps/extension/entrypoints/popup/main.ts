import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import "./popup.css";

const i18n = createI18n();
const { t } = i18n;

const style = document.createElement("style");
style.textContent = renderDesignCss(designTokens);
document.head.append(style);

document.documentElement.lang = i18n.language;
document.title = t("extension.title");

function element(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

document
  .querySelector("#app")
  ?.append(
    element("h1", t("extension.title")),
    element("p", t("extension.description")),
    element("p", t("extension.comingSoon"), "notice"),
  );
