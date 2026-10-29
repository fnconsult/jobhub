import type { ExtensionJobSiteList } from "@jobhub/shared";
import { designTokens } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { badgePlacement, placementCss } from "../src/badge-placement";
import { isOnJobSite, JOB_SITES, readJobPage } from "../src/job-page";
import { badgeShows, BUILT_IN_JOB_SITE_LIST, jobSiteListFrom } from "../src/job-sites";
import type { AnalyseReply, ExtensionMessage } from "../src/messages";
import { snapshotPage } from "../src/page-snapshot";

const { fontFamily, radius, space } = designTokens;
// On a job site's page, the badge is drawn in the light theme and the Confort Density (ADR-0054).
const color = Object.fromEntries(Object.entries(designTokens.color).map(([name, value]) => [name, value.light])) as Record<
  keyof typeof designTokens.color,
  string
>;
const { fontSize } = designTokens.density.confort;

/**
 * On major job boards and career sites, shows an "Analyser cette offre" badge
 * on job postings, following the Job Sites set in the Back Office (src/job-sites.ts).
 * The page is read here, in the person's own browser
 * (ADR-0002); only the Job Offer it describes is sent to Jobbbox.
 */
export default defineContentScript({
  matches: [...JOB_SITES],
  // A job site's posting may sit in an iframe on the employer's own site (gestmax.fr, #187).
  allFrames: true,
  runAt: "document_idle",
  async main(ctx) {
    // In an iframe, only a posting gets the badge (not a job site's widgets, nor ads), and only on another
    // site's page: on a job site's own page (Indeed's posting pane, say), the page shows it.
    const inTopFrame = window === window.top;
    if (!inTopFrame) {
      const topOrigin = [...location.ancestorOrigins].at(-1);
      if ((topOrigin && isOnJobSite(`${topOrigin}/`)) || !readJobPage(snapshotPage(document)).detected) return;
    }

    const language = await browser.runtime
      .sendMessage<ExtensionMessage, string | null>({ type: "interface-language" })
      .catch(() => null);
    const { t } = createI18n(language);
    // The Job Sites set in the Back Office: a disabled site gets no badge, an added site's posting pages do.
    const jobSites = await browser.runtime
      .sendMessage<ExtensionMessage, ExtensionJobSiteList | null>({ type: "job-sites" })
      .then((list) => jobSiteListFrom(list) ?? BUILT_IN_JOB_SITE_LIST)
      .catch(() => BUILT_IN_JOB_SITE_LIST);

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
      :host { all: initial; position: fixed; ${placementCss(badgePlacement(inTopFrame, space[6]))} z-index: 2147483647; font-family: ${fontFamily.sans}; }
      button { font: 600 ${fontSize.lead}px/1.25 ${fontFamily.sans}; color: ${color.onAccent}; background: ${color.accent};
               border: 0; border-radius: ${radius.control}px; padding: ${space[3]}px ${space[4]}px; cursor: pointer;
               box-shadow: 0 4px 16px rgb(0 0 0 / 20%); }
      button:focus-visible { outline: 3px solid ${color.accent}; outline-offset: 3px; }
      button[disabled] { cursor: progress; }
      p { margin: ${space[2]}px 0 0; max-width: 20rem; font-size: ${fontSize.body}px; line-height: 1.5; color: ${color.danger};
          background: ${color.background}; padding: ${space[2]}px; border-radius: ${radius.md}px; }
      p:empty { display: none; }`;
    shadow.append(style, button, status);

    button.addEventListener("click", async () => {
      status.textContent = "";
      const { jobOffer } = readJobPage(snapshotPage(document));
      // A posting's address with nothing to read yet (a page still loading, say): say so, as the Side Panel does.
      if (!jobOffer) return void (status.textContent = t("extension.captureImpossible"));
      button.disabled = true;
      const reply = await browser.runtime
        .sendMessage<ExtensionMessage, AnalyseReply>({ type: "analyse", jobOffer })
        .catch((): AnalyseReply => ({ ok: false, error: "unreachable" }));
      button.disabled = false;
      if (!reply.ok) status.textContent = t(reply.error === "invalid" ? "extension.captureImpossible" : "extension.unreachable");
    });

    // Job boards are single-page apps: check again when the URL changes, and once late content has loaded.
    const check = () => {
      const shown = host.isConnected;
      const detected = badgeShows(snapshotPage(document), jobSites);
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
