import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import type { JobOffer, MatchScore } from "@jobhub/shared";
import { browser } from "wxt/browser";
import { createApplicationSaving, type ProfileChoice, type SavingFailure, type SavingState } from "../../src/application-saving";
import { openAnalysisPage } from "../../src/analysis-page";
import { readCandidateSession } from "../../src/candidate-session";
import { createGuestSession } from "../../src/guest-session";
import { createJobbboxApi, type ProfileOption, type ScoreAgainst, type UpgradePrompt } from "../../src/jobbbox-api";
import { describeMatchScore, describeRescore } from "../../src/match-score-view";
import { chooseScoreAgainst, createMatchScoring, type ScoringChoice } from "../../src/match-scoring";
import { WEB_ORIGIN } from "../../src/web-app";
import "./analyse.css";

// The analysis page: the captured Job Offer and its Match Score, against the Guest's CV or, for a
// signed-in Candidate, one of their Profiles (#75); for a signed-in Candidate, saving the Job Offer as an Application.
const style = document.createElement("style");
style.textContent = renderDesignCss(designTokens);
document.head.append(style);

// Shared with the web app (ADR-0011): read again when the page comes back into view, so
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

function button(text: string, onClick: () => void, className?: string): HTMLButtonElement {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

type Message = { text: string; error?: boolean };

function status(message: Message): HTMLElement {
  const node = element("p", message.text, message.error ? "error" : undefined);
  node.setAttribute("role", message.error ? "alert" : "status");
  return node;
}

function describeJobOffer(jobOffer: JobOffer): HTMLElement {
  const where = [jobOffer.employer, jobOffer.location].filter(Boolean).join(" · ");
  const node = element("p", "", "job-offer");
  node.append(element("strong", jobOffer.title));
  if (where) node.append(` — ${where}`);
  return node;
}

/**
 * What happens to the CV and the Job Offer. A Guest's are forgotten within 24
 * hours (ADR-0003); a signed-in Candidate's Job Offer is kept in their account,
 * and only the CV stays in this browser.
 */
function dataNotice(expiresAt: number | undefined): HTMLElement {
  const notice = element("div", "", "notice");
  if (candidate.signedIn) {
    notice.append(element("p", t("extension.analysis.candidateNotice")), button(t("extension.analysis.forgetCv"), forget));
    return notice;
  }
  notice.append(element("p", t("extension.analysis.guestNotice")));
  if (expiresAt) {
    const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short" }).format(expiresAt);
    notice.append(element("p", t("extension.analysis.expiresAt", { date })));
  }
  notice.append(button(t("extension.analysis.forget"), forget));
  return notice;
}

/** The CV form: the file is read by Jobbbox (and kept by no one but this browser), then scored. */
function cvForm(): HTMLFormElement {
  const form = element("form");
  const label = element("label", t("cvUpload.fileLabel"));
  label.htmlFor = "cv";
  const hint = element("p", t("cvUpload.fileHint"));
  hint.id = "cv-hint";
  const input = element("input");
  Object.assign(input, { type: "file", id: "cv", name: "cv", accept: ".pdf,.docx", required: true });
  input.setAttribute("aria-describedby", "cv-hint");
  const submit = element("button", t("extension.analysis.submit"), "primary");
  submit.type = "submit";
  const progress = element("p");
  progress.setAttribute("role", "status");
  // One place for the latest error: a new attempt replaces the last one's message.
  const error = element("p", "", "error");
  error.setAttribute("role", "alert");
  form.append(label, hint, input, submit, progress, error);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) return;
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
  return form;
}

/** The signed-in Candidate's Plan allows no more Match Scores: what they reached, and a link to the Plan that allows more. */
function upgradePrompt(prompt: UpgradePrompt): HTMLElement {
  const node = element("div", "", "notice");
  node.setAttribute("role", "alert");
  node.append(element("p", prompt.message));
  if (prompt.action) {
    const link = element("a", prompt.action);
    Object.assign(link, { href: `${WEB_ORIGIN}${prompt.href}`, target: "_blank", rel: "noopener" });
    node.append(link);
  }
  return node;
}

function webLink(text: string, path: string): HTMLAnchorElement {
  const link = element("a", text);
  Object.assign(link, { href: `${WEB_ORIGIN}${path}`, target: "_blank", rel: "noopener" });
  return link;
}

/** Why the Job Offer could not be saved as an Application. */
function savingFailure(failure: SavingFailure): HTMLElement {
  if (failure.error === "plan_quota_reached") {
    return failure.prompt ? upgradePrompt(failure.prompt) : status({ text: t("extension.analysis.profileQuotaReached"), error: true });
  }
  if (failure.error === "search_criteria_missing") {
    const node = element("div", "", "notice");
    node.setAttribute("role", "alert");
    node.append(element("p", t("extension.analysis.searchCriteriaMissing")), webLink(t("extension.analysis.createProfile"), "/profils/nouveau"));
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
  const node = element("div", "", "notice");
  node.setAttribute("role", "status");
  node.append(element("p", t("extension.analysis.saved")));
  if (saved.newProfile) node.append(element("p", t("extension.analysis.profileCreated", { name: saved.newProfile.name })));
  node.append(webLink(t("extension.analysis.openApplication"), `/candidatures/${saved.applicationId}`));
  return node;
}

/** The signed-in Candidate chooses the Profile the Application uses, then it is saved. */
function saveForm(choice: Extract<SavingState, { state: "choose" }>, scoredProfileId: string | undefined, failure?: SavingFailure): HTMLElement[] {
  const title = element("h2", t("extension.analysis.saveTitle"));
  if (choice.profiles.length === 0 && !choice.fromCv) return [title, element("p", t("extension.analysis.firstProfileHint"))];

  const form = element("form");
  const label = element("label", t("extension.analysis.profileLabel"));
  label.htmlFor = "profile";
  const select = element("select");
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
  const submit = element("button", t("extension.analysis.save"), "primary");
  submit.type = "submit";
  const progress = element("p");
  progress.setAttribute("role", "status");
  form.append(label, select, submit, progress);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    progress.textContent = t("extension.analysis.saving");
    const chosen: ProfileChoice = select.value ? { profileId: select.value } : "new_profile_from_cv";
    await render(undefined, false, await saving.save(chosen));
  });
  return failure ? [title, savingFailure(failure), form] : [title, form];
}

/** The Match Score last shown on this page, which a rescore is compared with (#76). */
let shownMatchScore: MatchScore | undefined;

async function matchScore(jobOffer: JobOffer, against: ScoreAgainst, rescore: boolean): Promise<HTMLElement[]> {
  const previous = shownMatchScore;
  const scored = await scoring.score(jobOffer, against, { rescore });
  if (!scored.ok && scored.error === "quota_exceeded") return [upgradePrompt(scored.prompt)];
  if (!scored.ok) {
    const text = {
      job_offer_gone: t("extension.analysis.jobOfferGone"),
      not_found: t("extension.analysis.scoreNotFound"),
      signed_out: t("extension.signedOut"),
      failed: t("extension.unreachable"),
      unreachable: t("extension.unreachable"),
    }[scored.error];
    return [status({ text, error: true })];
  }
  shownMatchScore = scored.matchScore;
  const view = describeMatchScore(scored.matchScore, i18n);
  const list = element("ul", "", "criteria");
  for (const criterion of view.criteria) {
    const item = element("li");
    item.append(element("strong", criterion.label), element("br"), criterion.status);
    for (const detail of criterion.details) item.append(element("br"), detail);
    list.append(item);
  }
  const shown = [element("p", view.score, "score"), element("h2", t("extension.analysis.breakdownTitle")), list];
  // Said even when the value is the same, so the Candidate sees the rescore happened (#76).
  if (rescore) shown.unshift(status({ text: describeRescore({ previous, current: scored.matchScore, at: new Date() }, i18n) }));
  return shown;
}

/** What was chosen on this page to score against, if anything: a Profile from the select, or "Utiliser un autre CV". */
let scoringWith: ScoringChoice | undefined;

/** The signed-in Candidate chooses the Profile the Job Offer is scored against: it is scored again. */
function scoreProfileSelect(profiles: ProfileOption[], profileId: string): HTMLElement {
  const field = element("p");
  const label = element("label", t("extension.analysis.scoreProfileLabel"));
  label.htmlFor = "score-profile";
  const select = element("select");
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
  await session.forget();
  shownMatchScore = undefined;
  await render({ text: t("extension.analysis.forgotten") });
}

/**
 * `outcome`: what saving the Job Offer last came to. Without one, a signed-in Candidate's
 * saving is opened afresh, which keeps a Guest's work at once on sign-up. `rescore`: a new Match
 * Score is asked for, rather than the kept one.
 */
let renders = 0;
async function render(message?: Message, changingCv = false, outcome?: SavingState | SavingFailure, rescore = false) {
  const renderId = ++renders;
  if (candidate.signedIn && !outcome) outcome = await saving.open();
  if (outcome?.state === "saved") {
    app.replaceChildren(element("h1", t("extension.analysis.title")), describeJobOffer(outcome.jobOffer), savedNotice(outcome));
    return;
  }

  const content = await session.read();
  const { jobOffer, expiresAt } = content;
  const parts: (HTMLElement | string)[] = [element("h1", t("extension.analysis.title"))];
  if (message) parts.push(status(message));

  // The latest attempt's refusal, if any, is shown with the choice to try again.
  const failure = outcome?.state === "failed" ? outcome : undefined;
  const reopened = failure && failure.error !== "signed_out" ? await saving.open() : undefined;
  const choice = outcome?.state === "choose" ? outcome : reopened?.state === "choose" ? reopened : undefined;
  // A signed-in Candidate's Job Offer is scored against one of their Profiles, no CV needed (#75).
  const profiles = candidate.signedIn ? (choice?.profiles ?? []) : [];
  const against = chooseScoreAgainst(profiles, content, scoringWith);
  const scoredProfileId = against && "profileId" in against ? against.profileId : undefined;

  if (jobOffer && candidate.signedIn && outcome) {
    parts.push(describeJobOffer(jobOffer));
    if (choice) parts.push(...saveForm(choice, scoredProfileId, failure));
    else if (failure) parts.push(savingFailure(failure));
  }

  if (!jobOffer) {
    parts.push(element("p", t("extension.analysis.noJobOffer")));
  } else {
    if (!candidate.signedIn) parts.push(describeJobOffer(jobOffer));
    parts.push(dataNotice(expiresAt));
    const useProfile = () => {
      scoringWith = chooseScoreAgainst(profiles, { jobOffer, profileId: content.profileId }) as { profileId: string };
      void render();
    };
    if (scoredProfileId) {
      parts.push(element("h2", t("extension.analysis.profileTitle")), scoreProfileSelect(profiles, scoredProfileId));
    } else {
      parts.push(element("h2", t("extension.analysis.cvTitle")));
    }
    if (against && !changingCv) {
      app.replaceChildren(...parts, status({ text: t("extension.analysis.scoring") }));
      parts.push(...(await matchScore(jobOffer, against, rescore)));
      // Another render ("Oublier", say) began while the Match Score was computed: it has the page now.
      if (renderId !== renders) return;
      const actions = element("div", "", "actions");
      // A rescore asks once, however often it is clicked.
      const scoreAgain = (trigger: HTMLButtonElement) => {
        if (trigger.disabled) return;
        trigger.disabled = true;
        void render(undefined, false, undefined, true);
      };
      // A signed-in Candidate's rescore uses a Match Score of their Plan Quota: it is confirmed first (#76).
      const confirmRescore = () => {
        const confirmation = element("div", "", "notice");
        const confirm = button(t("extension.analysis.rescoreConfirmAction"), () => scoreAgain(confirm), "primary");
        const cancel = button(t("extension.analysis.rescoreCancel"), () => confirmation.replaceWith(actions));
        confirmation.append(element("p", t("extension.analysis.rescoreConfirm")), confirm, cancel);
        actions.replaceWith(confirmation);
        confirm.focus();
      };
      const rescoreButton = button(t("extension.analysis.rescore"), () => (candidate.signedIn ? confirmRescore() : scoreAgain(rescoreButton)));
      const changeCv = () => {
        scoringWith = "cv";
        void render(undefined, true);
      };
      actions.append(rescoreButton, button(t("extension.analysis.changeCv"), changeCv));
      if ("cv" in against && profiles.length > 0) actions.append(button(t("extension.analysis.useProfile"), useProfile));
      parts.push(actions);
    } else {
      parts.push(cvForm());
      if (profiles.length > 0) parts.push(button(t("extension.analysis.useProfile"), useProfile));
    }
  }

  if (!candidate.signedIn) {
    const paragraph = element("p");
    paragraph.append(webLink(t("extension.analysis.signUp"), "/connexion"));
    parts.push(paragraph);
    if (jobOffer) parts.push(element("p", t("extension.analysis.signUpHint")));
  }
  app.replaceChildren(...parts);
}

// The session is watched before the first render, which a Match Score waiting on another page's can hold up (#66).
await openAnalysisPage({
  signedIn: candidate.signedIn,
  readSession: () => readCandidateSession(WEB_ORIGIN),
  reload: () => location.reload(),
  render: () => render(),
  document,
  window,
});
