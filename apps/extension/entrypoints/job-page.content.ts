import { designTokens } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { JOB_SITES, readJobPage } from "../src/job-page";
import type { AnalyseReply, ExtensionMessage } from "../src/messages";
import { snapshotPage } from "../src/page-snapshot";

const { color, fontFamily, fontSize, radius, space } = designTokens;

/**
 * On major job boards and career sites, shows an "Analyser cette offre" badge
 * on job postings. The page is read here, in the person's own browser
 * (ADR-0002); only the Job Offer it describes is sent to Jobbbox.
 */
export default defineContentScript({
  matches: [...JOB_SITES],
  runAt: "document_idle",
  async main(ctx) {
    const language = await browser.runtime
      .sendMessage<ExtensionMessage, string | null>({ type: "interface-language" })
      .catch(() => null);
    const { t } = createI18n(language);

    const host = document.createElement("jobbbox-badge");
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("extension.badge");
    button.setAttribute("aria-label", t("extension.badgeLabel"));
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; position: fixed; right: ${space[6]}px; bottom: ${space[6]}px; z-index: 2147483647; font-family: ${fontFamily.sans}; }
      button { font: 600 ${fontSize.lead}px/1.25 ${fontFamily.sans}; color: ${color.onAccent}; background: ${color.accent};
               border: 0; border-radius: ${radius.lg}px; padding: ${space[3]}px ${space[4]}px; cursor: pointer;
               box-shadow: 0 4px 16px rgb(0 0 0 / 20%); }
      button:focus-visible { outline: 3px solid ${color.focusRing}; outline-offset: 3px; }
      button[disabled] { cursor: progress; }
      p { margin: ${space[2]}px 0 0; max-width: 20rem; font-size: ${fontSize.body}px; line-height: 1.5; color: ${color.danger};
          background: ${color.background}; padding: ${space[2]}px; border-radius: ${radius.md}px; }
      p:empty { display: none; }`;
    shadow.append(style, button, status);

    button.addEventListener("click", async () => {
      const { jobOffer } = readJobPage(snapshotPage(document));
      if (!jobOffer) return;
      button.disabled = true;
      status.textContent = "";
      const reply = await browser.runtime
        .sendMessage<ExtensionMessage, AnalyseReply>({ type: "analyse", jobOffer })
        .catch((): AnalyseReply => ({ ok: false, error: "unreachable" }));
      button.disabled = false;
      if (!reply.ok) status.textContent = t(reply.error === "invalid" ? "extension.captureImpossible" : "extension.unreachable");
    });

    // Job boards are single-page apps: check again when the URL changes, and once late content has loaded.
    const check = () => {
      const shown = host.isConnected;
      const detected = readJobPage(snapshotPage(document)).detected;
      if (detected && !shown) document.documentElement.append(host);
      if (!detected && shown) host.remove();
    };
    check();
    ctx.setTimeout(check, 2000);
    ctx.addEventListener(window, "wxt:locationchange", () => {
      check();
      ctx.setTimeout(check, 2000);
    });
    ctx.onInvalidated(() => host.remove());
  },
});
