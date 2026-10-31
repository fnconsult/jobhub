import { designTokens, followTheme, PREFERS_DARK, renderDesignCss, trackScrolling } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import type { JobOffer, MatchScore } from "@jobhub/shared";
import { browser } from "wxt/browser";
import { ALL_SITES } from "../../src/all-sites-detection";
import { createApplicationSaving, type ProfileChoice, type SavingFailure, type SavingState } from "../../src/application-saving";
import { openAnalysisPage } from "../../src/analysis-page";
import { readCandidateSession } from "../../src/candidate-session";
import { choosePage } from "../../src/frame-choice";
import { createGuestSession } from "../../src/guest-session";
import type { JobPage } from "../../src/job-page";
import { createJobbboxApi, type ProfileOption, type ScoreAgainst, type UpgradePrompt } from "../../src/jobbbox-api";
import { describeMatchScore, describeRescore, type MatchScoreView } from "../../src/match-score-view";
import { chooseScoreAgainst, createMatchScoring, type ScoringChoice } from "../../src/match-scoring";
import type { AnalyseReply, ExtensionMessage } from "../../src/messages";
import { watchPostingInView, type PageInView } from "../../src/posting-in-view";
import { WEB_ORIGIN } from "../../src/web-app";
// Inter, bundled with the extension: no request to a font CDN (ADR-0053).
import "@fontsource-variable/inter";
// The Design System's simple components, in the Confort Density (ADR-0054): the web app's own stylesheets.
import "../../../web/src/design/Button.css";
import "../../../web/src/design/Field.css";
import "../../../web/src/design/Note.css";
import "../../../web/src/design/Pill.css";
import "../../../web/src/design/Ring.css";
import "./sidepanel.css";

// The Side Panel (ADR-0054): docked beside the page, it stays open from tab to tab and follows the posting in view.
// It shows the captured Job Offer and its Match Score, against the Guest's CV or, for a signed-in Candidate, one of
// their Profiles (#75); for a signed-in Candidate, saving the Job Offer as an Application.
const style = document.createElement("style");
style.textContent = renderDesignCss(designTokens);
document.head.append(style);
// The device's light or dark theme (#473): the Candidate's choice in Préférences stays on the web app's origin, so
// the Side Panel follows Système, the default, the way index.html's color-scheme already draws it before this runs.
followTheme(document.documentElement, window.matchMedia(PREFERS_DARK), () => null);
trackScrolling(document);

// Shared with the web app (ADR-0011): read again when the panel comes back into view, so
// signing up or in on the web app, in another tab, is seen here (and the Guest's work kept).
const candidate = await readCandidateSession(WEB_ORIGIN);
const i18n = createI18n(candidate.signedIn ? candidate.candidate.interfaceLanguage : undefined);
const { t } = i18n;
document.documentElement.lang = i18n.language;
document.title = `${t("extension.analysis.title")} – Jobbbox`;

const session = createGuestSession(browser.storage.session);
const api = createJobbboxApi(WEB_ORIGIN);
const saving = createApplicationSaving({ api, session });
// Shown again on reopen rather than computed again: each Match Score uses the Candidate's Plan Quota (#51).
const scoring = createMatchScoring({ api, session });
const app = document.querySelector<HTMLElement>("#app")!;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

/** A Design System button (ADR-0053): secondary unless said otherwise. */
const buttonClass = (variant: ButtonVariant = "secondary", small = false) =>
  ["ds-button", `ds-button--${variant}`, small ? "ds-button--sm" : ""].filter(Boolean).join(" ");

function button(text: string, onClick: () => void, variant?: ButtonVariant, small = false): HTMLButtonElement {
  const node = element("button", text, buttonClass(variant, small));
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function webLink(text: string, path: string, className?: string): HTMLAnchorElement {
  const link = element("a", text, className);
  Object.assign(link, { href: `${WEB_ORIGIN}${path}`, target: "_blank", rel: "noopener" });
  return link;
}

/** A Lucide icon, drawn at stroke 1.7 like the web app's (decoration: the words say it). */
const ICONS = {
  info: ["M12 16v-4", "M12 8h.01", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0"],
  success: ["M20 6 9 17l-5-5"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"],
  clock: ["M12 6v6l4 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0"],
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** A Design System Note: its icon, then its words. */
function note(tone: "info" | "success" | "warn" | "danger", ...content: (Node | string)[]): HTMLElement {
  const node = element("div", "", "ds-note");
  node.dataset.tone = tone;
  const text = element("div");
  text.append(...content);
  node.append(icon(tone === "success" ? "success" : "info"), text);
  return node;
}

type Message = { text: string; error?: boolean };

function status(message: Message): HTMLElement {
  const node = element("p", message.text, message.error ? "error" : undefined);
  node.setAttribute("role", message.error ? "alert" : "status");
  return node;
}

/** The Job Offer: its title, where and for whom, and the Match Score's ring once there is one. */
function jobOfferHead(jobOffer: JobOffer): { node: HTMLElement; show: (view: MatchScoreView) => void } {
  const node = element("div", "", "job-offer");
  const text = element("div", "", "job-offer__text");
  text.append(element("h2", jobOffer.title, "job-offer__title"));
  const where = [jobOffer.employer, jobOffer.location].filter(Boolean).join(" · ");
  if (where) text.append(element("p", where, "meta"));
  node.append(text);
  return {
    node,
    show(view) {
      text.append(element("p", view.score, "score"));
      if (view.ring === undefined) return;
      // The score line above says it: the ring only draws it.
      const ring = element("span", "", "ds-ring");
      ring.setAttribute("aria-hidden", "true");
      ring.style.setProperty("--ds-ring-value", String(view.ring));
      ring.append(element("span", String(view.ring)));
      node.append(ring);
    },
  };
}

/** The posting in view (src/posting-in-view.ts): the person's own browser read it; nothing is captured until they click. */
let inView: PageInView | null = null;

const sameAddress = (a?: string, b?: string) => !!a && !!b && a.split("#")[0] === b.split("#")[0];

/** « Offre détectée sur cette page »: the Job Offer shown, or another one to analyse in a click. */
function inViewNote(shown?: JobOffer): HTMLElement[] {
  if (!inView?.detected) return [];
  if (shown && sameAddress(shown.source.url, inView.jobOffer.source.url)) return [note("success", t("extension.detected"))];
  const posting = inView.jobOffer;
  const progress = element("p");
  progress.setAttribute("role", "status");
  const analyse = button(
    t("extension.badge"),
    async () => {
      analyse.disabled = true;
      progress.textContent = t("extension.capturing");
      const reply = await capture(posting);
      analyse.disabled = false;
      // Captured: the Guest session changed, and the panel shows the new Job Offer.
      progress.textContent = reply.ok ? "" : t(reply.error === "invalid" ? "extension.captureImpossible" : "extension.unreachable");
    },
    "primary",
    true,
  );
  return [note("success", element("p", t("extension.detected")), element("strong", posting.title), analyse, progress)];
}

/** A Capture, by the background (which keeps the Job Offer in the Guest session, src/side-panel.ts). */
function capture(jobOffer: PageInView["jobOffer"]): Promise<AnalyseReply> {
  return browser.runtime
    .sendMessage<ExtensionMessage, AnalyseReply>({ type: "analyse", jobOffer })
    .catch((): AnalyseReply => ({ ok: false, error: "unreachable" }));
}

/** The page a tab shows, read in the person's own browser (ADR-0002); null when it cannot be read. */
async function readTab(tabId: number): Promise<PageInView | null> {
  // Job Sites (host permissions) cover a job site's iframe in another site's page (gestmax.fr, #187); activeTab, the
  // page the toolbar icon was clicked on.
  const read = (allFrames: boolean) => browser.scripting.executeScript({ target: { tabId, allFrames }, files: ["/capture.js"] });
  try {
    // A frame that cannot be read (another site's ad, say) is left out; should it fail the whole read, the page alone.
    const injections = await read(true).catch(() => read(false));
    return choosePage(injections.map(({ frameId, result }) => ({ frameId, page: (result as JobPage | null | undefined) ?? null })));
  } catch {
    return null; // Browser pages, extension stores and the like cannot be read.
  }
}

/** Manual Capture of the page in the active tab, on any site. */
function capturePage(): HTMLElement {
  const node = element("div", "", "capture-page");
  const progress = element("p", "", "status");
  progress.setAttribute("role", "status");
  const trigger = button(t("extension.capturePage"), async () => {
    trigger.disabled = true;
    progress.textContent = t("extension.capturing");
    const [tab] = await browser.tabs.query({ active: true, windowId });
    const page = tab?.id === undefined ? null : await readTab(tab.id);
    const reply: AnalyseReply | { ok: false; error: "impossible" } = page ? await capture(page.jobOffer) : { ok: false, error: "impossible" };
    trigger.disabled = false;
    progress.textContent = reply.ok ? "" : t(reply.error === "unreachable" ? "extension.unreachable" : "extension.captureImpossible");
  });
  node.append(element("p", t("extension.description")), trigger, progress);
  return node;
}

/**
 * The badge on every site, for employers' own career sites: off by default, so
 * the extension reads no other site until the person grants it, here.
 */
async function allSitesOption(): Promise<HTMLElement> {
  const option = element("div", "", "option");
  const input = document.createElement("input");
  Object.assign(input, { type: "checkbox", id: "all-sites", checked: await browser.permissions.contains({ origins: [...ALL_SITES] }) });
  input.setAttribute("aria-describedby", "all-sites-hint");
  const label = element("label", t("extension.allSites"));
  label.htmlFor = "all-sites";
  const hint = element("p", t("extension.allSitesHint"), "ds-field__hint");
  hint.id = "all-sites-hint";
  input.addEventListener("change", async () => {
    const permissions = { origins: [...ALL_SITES] };
    // The background registers or removes the badge when the permission changes.
    const granted = input.checked
      ? await browser.permissions.request(permissions).catch(() => false)
      : !(await browser.permissions.remove(permissions).catch(() => false));
    input.checked = granted;
  });
  const row = element("div", "", "ds-choice");
  row.append(input, label);
  option.append(row, hint);
  return option;
}

/** What the extension does besides the Job Offer: Capture by hand, the badge on every site, the account. Built once. */
const extras = element("section", "", "extras");
extras.append(await allSitesOption());
if (candidate.signedIn) {
  const account = element("p", t("extension.signedInAs", { email: candidate.candidate.email }), "account");
  account.append(" ", webLink(t("extension.account"), "/compte"));
  extras.append(account);
}

function extrasFor(shown?: JobOffer): HTMLElement {
  // A posting in view is analysed from its note; any other page can still be captured by hand.
  const manual = inView?.detected ? [] : [capturePage()];
  extras.replaceChildren(...manual, ...Array.from(extras.children).filter((child) => !child.classList.contains("capture-page")));
  void shown;
  return extras;
}

/** The CV form: the file is read by Jobbbox (and kept by no one but this browser), then scored. Its submit button may sit in the footer. */
function cvForm(): { form: HTMLFormElement; submit: HTMLButtonElement } {
  const form = element("form", "", "cv-form");
  form.id = "cv-form";
  const label = element("label", t("cvUpload.fileLabel"), "ds-field__label");
  label.htmlFor = "cv";
  const hint = element("p", t("cvUpload.fileHint"), "ds-field__hint");
  hint.id = "cv-hint";
  const input = element("input", "", "visually-hidden");
  Object.assign(input, { type: "file", id: "cv", name: "cv", accept: ".pdf,.docx", required: true });
  input.setAttribute("aria-describedby", "cv-hint");
  // The drop zone: a CV dropped on it, or chosen with « Choisir un fichier » (a second label of the same input).
  const drop = element("div", "", "drop-zone");
  const choose = element("label", t("extension.analysis.chooseFile"), buttonClass("secondary", true));
  choose.htmlFor = "cv";
  const chosen = element("p", "", "drop-zone__file");
  drop.append(icon("upload"), element("strong", t("extension.analysis.dropCv")), choose, chosen, hint);
  const show = () => (chosen.textContent = input.files?.[0]?.name ?? "");
  input.addEventListener("change", show);
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    if (!event.dataTransfer?.files.length) return;
    input.files = event.dataTransfer.files;
    show();
  });
  const submit = element("button", t("extension.analysis.submit"), buttonClass("primary"));
  submit.type = "submit";
  submit.setAttribute("form", form.id);
  const progress = element("p");
  progress.setAttribute("role", "status");
  // One place for the latest error: a new attempt replaces the last one's message.
  const error = element("p", "", "error");
  error.setAttribute("role", "alert");
  form.append(label, input, drop, progress, error);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) {
      input.reportValidity();
      return;
    }
    submit.disabled = true;
    error.textContent = "";
    progress.textContent = t("cvUpload.reading");
    const read = await api.readCv(file);
    if (!read.ok) {
      submit.disabled = false;
      progress.textContent = "";
      error.textContent = read.error === "unreachable" ? t("extension.unreachable") : t(`cvUpload.errors.${read.error}`);
      return;
    }
    await session.keepCv(read.cv, read.searchCriteria);
    await render();
  });
  return { form, submit };
}

/** The signed-in Candidate's Plan allows no more Match Scores: what they reached, and a link to the Plan that allows more. */
function upgradePrompt(prompt: UpgradePrompt): HTMLElement {
  const node = note("warn", element("p", prompt.message));
  node.setAttribute("role", "alert");
  if (prompt.action) node.lastElementChild!.append(webLink(prompt.action, prompt.href));
  return node;
}

/** Why the Job Offer could not be saved as an Application. */
function savingFailure(failure: SavingFailure): HTMLElement {
  if (failure.error === "plan_quota_reached") {
    return failure.prompt ? upgradePrompt(failure.prompt) : status({ text: t("extension.analysis.profileQuotaReached"), error: true });
  }
  if (failure.error === "search_criteria_missing") {
    const node = note("warn", element("p", t("extension.analysis.searchCriteriaMissing")), webLink(t("extension.analysis.createProfile"), "/profils/nouveau"));
    node.setAttribute("role", "alert");
    return node;
  }
  const text = {
    job_offer_gone: t("extension.analysis.jobOfferGone"),
    signed_out: t("extension.signedOut"),
    unreachable: t("extension.unreachable"),
  }[failure.error];
  return status({ text, error: true });
}

/** The Job Offer saved as an Application: where to follow it, and the Profile made from the CV, if one was. */
function savedNotice(saved: Extract<SavingState, { state: "saved" }>): HTMLElement {
  // Every page of the extension shows it, until another Job Offer is captured.
  const content: (Node | string)[] = [element("p", t("extension.analysis.saved"))];
  if (saved.newProfile) content.push(element("p", t("extension.analysis.profileCreated", { name: saved.newProfile.name })));
  content.push(webLink(t("extension.analysis.openApplication"), `/candidatures/${saved.applicationId}`));
  const node = note("success", ...content);
  node.setAttribute("role", "status");
  return node;
}

/** The signed-in Candidate chooses the Profile the Application uses, then it is saved: « Enregistrer en candidature », in the footer. */
function saveForm(choice: Extract<SavingState, { state: "choose" }>, scoredProfileId: string | undefined): HTMLElement {
  const form = element("form", "", "save-form");
  const field = element("div", "", "ds-field");
  const label = element("label", t("extension.analysis.profileLabel"), "ds-field__label");
  label.htmlFor = "profile";
  const select = element("select", "", "ds-input ds-select");
  select.id = "profile";
  for (const profile of choice.profiles) {
    const option = element("option", profile.name);
    option.value = profile.id;
    // The Profile the Job Offer is scored against is the one it is most likely saved with.
    option.selected = profile.id === scoredProfileId;
    select.append(option);
  }
  if (choice.fromCv) {
    const option = element("option", t("extension.analysis.newProfileFromCv"));
    option.value = "";
    select.append(option);
  }
  field.append(label, select);
  const submit = element("button", t("extension.analysis.save"), buttonClass("primary"));
  submit.type = "submit";
  const progress = element("p");
  progress.setAttribute("role", "status");
  form.append(field, submit, progress);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    progress.textContent = t("extension.analysis.saving");
    const chosen: ProfileChoice = select.value ? { profileId: select.value } : "new_profile_from_cv";
    await render(undefined, false, await saving.save(chosen));
  });
  return form;
}

/** The Match Score last shown in the panel, which a rescore is compared with (#76). */
let shownMatchScore: MatchScore | undefined;

/** The Match Score's detail: the five criteria as bars, « non précisé » when one could not be compared. */
function criteriaList(view: MatchScoreView): HTMLElement {
  const list = element("ul", "", "criteria");
  for (const criterion of view.criteria) {
    const item = element("li", "", "criterion");
    const row = element("div", "", "criterion__row");
    row.append(element("strong", criterion.label), element("span", criterion.points, "criterion__points"));
    item.append(row);
    if (criterion.fill !== undefined) {
      const bar = element("span", "", "criterion__bar");
      bar.setAttribute("aria-hidden", "true");
      const fill = element("span");
      fill.style.setProperty("--fill", `${criterion.fill}%`);
      bar.append(fill);
      item.append(bar);
    }
    item.append(element("p", criterion.status, "criterion__status"));
    for (const detail of criterion.details) item.append(element("p", detail, "criterion__detail"));
    list.append(item);
  }
  return list;
}

async function matchScore(jobOffer: JobOffer, against: ScoreAgainst, rescore: boolean): Promise<{ parts: HTMLElement[]; view?: MatchScoreView }> {
  const previous = shownMatchScore;
  const scored = await scoring.score(jobOffer, against, { rescore });
  if (!scored.ok && scored.error === "quota_exceeded") return { parts: [upgradePrompt(scored.prompt)] };
  if (!scored.ok) {
    const text = {
      job_offer_gone: t("extension.analysis.jobOfferGone"),
      not_found: t("extension.analysis.scoreNotFound"),
      signed_out: t("extension.signedOut"),
      failed: t("extension.unreachable"),
      unreachable: t("extension.unreachable"),
    }[scored.error];
    return { parts: [status({ text, error: true })] };
  }
  shownMatchScore = scored.matchScore;
  const view = describeMatchScore(scored.matchScore, i18n);
  const detail = element("section", "", "detail");
  detail.append(element("h3", t("extension.analysis.breakdownTitle"), "label"), criteriaList(view));
  const parts: HTMLElement[] = [...view.notes.map((text) => note("info", text)), detail];
  // Said even when the value is the same, so the Candidate sees the rescore happened (#76).
  if (rescore) parts.unshift(status({ text: describeRescore({ previous, current: scored.matchScore, at: new Date() }, i18n) }));
  return { parts, view };
}

/** What was chosen in the panel to score against, if anything: a Profile from the select, or "Utiliser un autre CV". */
let scoringWith: ScoringChoice | undefined;

/** The signed-in Candidate chooses the Profile the Job Offer is scored against: it is scored again. */
function scoreProfileSelect(profiles: ProfileOption[], profileId: string): HTMLElement {
  const field = element("div", "", "ds-field");
  const label = element("label", t("extension.analysis.scoreProfileLabel"), "ds-field__label");
  label.htmlFor = "score-profile";
  const select = element("select", "", "ds-input ds-select");
  select.id = "score-profile";
  for (const profile of profiles) {
    const option = element("option", profile.name);
    option.value = profile.id;
    option.selected = profile.id === profileId;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    scoringWith = { profileId: select.value };
    await session.chooseProfile(select.value);
    await render();
  });
  field.append(label, select);
  return field;
}

async function forget() {
  // Shown as forgotten below: the session's change is not another Job Offer to show.
  shownJobOfferId = undefined;
  await session.forget();
  shownMatchScore = undefined;
  await render({ text: t("extension.analysis.forgotten") });
}

/** When a Guest's data goes (ADR-0003): at most 24 hours after their first analysis. */
function eraseTime(expiresAt: number): HTMLElement {
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short" }).format(expiresAt);
  const node = element("p", "", "erase-time");
  node.append(icon("clock"), t("extension.analysis.expiresAt", { date }));
  return node;
}

/** The panel's header: the « Jobbbox » wordmark, its title, and « Invité » for a Guest. */
function header(): HTMLElement {
  const head = element("header", "", "panel-head");
  head.append(element("span", t("app.name"), "wordmark"), element("h1", t("extension.analysis.title")));
  if (!candidate.signedIn) {
    const pill = element("span", t("extension.guest"), "ds-pill");
    pill.dataset.tone = "accent";
    head.append(pill);
  }
  return head;
}

/** Lays the panel out: its header, its body (which scrolls), and the footer's actions. */
function show(body: (Node | string)[], foot: (Node | string)[]) {
  const main = element("div", "", "panel-body");
  main.append(...body);
  const parts: HTMLElement[] = [header(), main];
  if (foot.length) {
    const footer = element("footer", "", "panel-foot");
    footer.append(...foot);
    parts.push(footer);
  }
  app.replaceChildren(...parts);
}

/** The Job Offer last shown: another one in the Guest session (captured from a badge, say) is shown at once. */
let shownJobOfferId: string | undefined;

/**
 * `outcome`: what saving the Job Offer last came to. Without one, a signed-in Candidate's
 * saving is opened afresh, which keeps a Guest's work at once on sign-up. `rescore`: a new Match
 * Score is asked for, rather than the kept one.
 */
let renders = 0;
async function render(message?: Message, changingCv = false, outcome?: SavingState | SavingFailure, rescore = false) {
  const renderId = ++renders;
  if (candidate.signedIn && !outcome) outcome = await saving.open();
  if (renderId !== renders) return;
  if (outcome?.state === "saved") {
    shownJobOfferId = undefined;
    show([...inViewNote(outcome.jobOffer), jobOfferHead(outcome.jobOffer).node, savedNotice(outcome), extrasFor(outcome.jobOffer)], []);
    return;
  }

  const content = await session.read();
  const { jobOffer, expiresAt } = content;
  shownJobOfferId = jobOffer?.id;
  const body: (Node | string)[] = [];
  const foot: (Node | string)[] = [];
  if (message) body.push(status(message));
  body.push(...inViewNote(jobOffer));

  // The latest attempt's refusal, if any, is shown with the choice to try again.
  const failure = outcome?.state === "failed" ? outcome : undefined;
  const reopened = failure && failure.error !== "signed_out" ? await saving.open() : undefined;
  const choice = outcome?.state === "choose" ? outcome : reopened?.state === "choose" ? reopened : undefined;
  // A signed-in Candidate's Job Offer is scored against one of their Profiles, no CV needed (#75).
  const profiles = candidate.signedIn ? (choice?.profiles ?? []) : [];
  const against = chooseScoreAgainst(profiles, content, scoringWith);
  const scoredProfileId = against && "profileId" in against ? against.profileId : undefined;
  const scored = !!jobOffer && !!against && !changingCv;

  if (!jobOffer) {
    body.push(element("p", t("extension.analysis.noJobOffer")));
  } else {
    if (!candidate.signedIn) body.push(note("info", t("extension.analysis.guestNotice")));
    const head = jobOfferHead(jobOffer);
    body.push(head.node);
    if (failure) body.push(savingFailure(failure));
    if (scoredProfileId) body.push(scoreProfileSelect(profiles, scoredProfileId));
    const useProfile = () => {
      scoringWith = chooseScoreAgainst(profiles, { jobOffer, profileId: content.profileId }) as { profileId: string };
      void render();
    };
    if (scored) {
      show([...body, status({ text: t("extension.analysis.scoring") })], []);
      const { parts, view } = await matchScore(jobOffer, against, rescore);
      // Another render ("Effacer", say) began while the Match Score was computed: it has the panel now.
      if (renderId !== renders) return;
      if (view) head.show(view);
      if (view && candidate.signedIn) body.push(...view.strengthsAndGaps.map((line) => element("p", line, "strengths")));
      const actions = element("div", "", "actions");
      // A rescore asks once, however often it is clicked.
      const scoreAgain = (trigger: HTMLButtonElement) => {
        if (trigger.disabled) return;
        trigger.disabled = true;
        void render(undefined, false, undefined, true);
      };
      // A signed-in Candidate's rescore uses a Match Score of their Plan Quota: it is confirmed first (#76).
      const confirmRescore = () => {
        const confirm = button(t("extension.analysis.rescoreConfirmAction"), () => scoreAgain(confirm), "primary", true);
        const cancel = button(t("extension.analysis.rescoreCancel"), () => confirmation.replaceWith(actions), "secondary", true);
        const confirmation = note("warn", element("p", t("extension.analysis.rescoreConfirm")), confirm, cancel);
        actions.replaceWith(confirmation);
        confirm.focus();
      };
      const rescoreButton = button(
        t("extension.analysis.rescore"),
        () => (candidate.signedIn ? confirmRescore() : scoreAgain(rescoreButton)),
        "secondary",
        true,
      );
      const changeCv = () => {
        scoringWith = "cv";
        void render(undefined, true);
      };
      actions.append(rescoreButton, button(t("extension.analysis.changeCv"), changeCv, "quiet", true));
      if ("cv" in against && profiles.length > 0) actions.append(button(t("extension.analysis.useProfile"), useProfile, "quiet", true));
      body.push(actions, ...parts);
    } else {
      const { form, submit } = cvForm();
      // The form's own label says « Votre CV »; a Candidate scored against a Profile is told which one first.
      if (scoredProfileId) body.push(element("h3", t("extension.analysis.profileTitle"), "label"));
      body.push(form);
      if (profiles.length > 0) body.push(button(t("extension.analysis.useProfile"), useProfile, "quiet", true));
      // A Guest's first step is the footer's: « Calculer mon Match Score ».
      if (candidate.signedIn) form.append(submit);
      else foot.push(submit, webLink(t("extension.analysis.signIn"), "/connexion", buttonClass("quiet")));
    }
    // What happens to the CV and the Job Offer: a Guest's are forgotten within 24 hours (ADR-0003); a signed-in
    // Candidate's Job Offer is kept in their account, and only the CV stays in this browser.
    if (candidate.signedIn) {
      body.push(note("info", element("p", t("extension.analysis.candidateNotice")), button(t("extension.analysis.forgetCv"), forget, "quiet", true)));
    } else {
      if (expiresAt) body.push(eraseTime(expiresAt));
      if (scored) {
        body.push(element("p", t("extension.analysis.signUpHint"), "hint"));
        foot.push(
          webLink(t("extension.analysis.signUp"), "/connexion", buttonClass("primary")),
          button(t("extension.analysis.forget"), forget, "danger"),
        );
      } else {
        body.push(button(t("extension.analysis.forget"), forget, "danger", true));
      }
    }
  }

  if (candidate.signedIn && jobOffer) {
    if (choice && (choice.profiles.length > 0 || choice.fromCv)) foot.push(saveForm(choice, scoredProfileId));
    else if (choice) body.push(element("p", t("extension.analysis.firstProfileHint")));
  }
  if (!candidate.signedIn && !jobOffer) foot.push(webLink(t("extension.analysis.signIn"), "/connexion", buttonClass("quiet")));
  body.push(extrasFor(jobOffer));
  show(body, foot);
}

const { id: windowId } = await browser.windows.getCurrent();

// The panel follows the posting in view, from tab to tab (ADR-0054).
watchPostingInView({
  tabs: browser.tabs,
  windowId: windowId!,
  readTab,
  onChange(page) {
    inView = page;
    void render();
  },
});

// A Job Offer captured meanwhile (from a badge, while the panel is open), or the Guest session forgotten at its end: shown at once.
browser.storage.session.onChanged.addListener(() => {
  void session.read().then(({ jobOffer }) => {
    if (jobOffer?.id !== shownJobOfferId) void render();
  });
});

// The session is watched before the first render, which a Match Score waiting on another page's can hold up (#66).
await openAnalysisPage({
  signedIn: candidate.signedIn,
  readSession: () => readCandidateSession(WEB_ORIGIN),
  reload: () => location.reload(),
  render: () => render(),
  document,
  window,
});
