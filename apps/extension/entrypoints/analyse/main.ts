import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import type { CvContent, JobOffer } from "@jobhub/shared";
import { browser } from "wxt/browser";
import { createApplicationSaving, type ProfileChoice, type SavingFailure, type SavingState } from "../../src/application-saving";
import { readCandidateSession } from "../../src/candidate-session";
import { createGuestSession } from "../../src/guest-session";
import { createJobbboxApi, type UpgradePrompt } from "../../src/jobbbox-api";
import { describeMatchScore } from "../../src/match-score-view";
import { WEB_ORIGIN } from "../../src/web-app";
import "./analyse.css";

// The analysis page: the captured Job Offer, the Guest's CV and their Match Score;
// for a signed-in Candidate, saving the Job Offer as an Application.
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
function saveForm(choice: Extract<SavingState, { state: "choose" }>, failure?: SavingFailure): HTMLElement[] {
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

async function matchScore(jobOffer: JobOffer, cv: CvContent): Promise<HTMLElement[]> {
  const scored = await api.score(jobOffer.id, cv);
  if (!scored.ok && scored.error === "quota_exceeded") return [upgradePrompt(scored.prompt)];
  if (!scored.ok) {
    const text = scored.error === "job_offer_gone" ? t("extension.analysis.jobOfferGone") : t("extension.unreachable");
    return [status({ text, error: true })];
  }
  const view = describeMatchScore(scored.matchScore, i18n);
  const list = element("ul", "", "criteria");
  for (const criterion of view.criteria) {
    const item = element("li");
    item.append(element("strong", criterion.label), element("br"), criterion.status);
    for (const detail of criterion.details) item.append(element("br"), detail);
    list.append(item);
  }
  return [element("p", view.score, "score"), element("h2", t("extension.analysis.breakdownTitle")), list];
}

async function forget() {
  await session.forget();
  await render({ text: t("extension.analysis.forgotten") });
}

/**
 * `outcome`: what saving the Job Offer last came to. Without one, a signed-in Candidate's
 * saving is opened afresh, which keeps a Guest's work at once on sign-up.
 */
async function render(message?: Message, changingCv = false, outcome?: SavingState | SavingFailure) {
  if (candidate.signedIn && !outcome) outcome = await saving.open();
  if (outcome?.state === "saved") {
    app.replaceChildren(element("h1", t("extension.analysis.title")), describeJobOffer(outcome.jobOffer), savedNotice(outcome));
    return;
  }

  const { jobOffer, cv, expiresAt } = await session.read();
  const parts: (HTMLElement | string)[] = [element("h1", t("extension.analysis.title"))];
  if (message) parts.push(status(message));

  if (jobOffer && candidate.signedIn && outcome) {
    parts.push(describeJobOffer(jobOffer));
    if (outcome.state === "choose") {
      // The latest attempt's refusal, if any, is shown with the choice to try again.
      parts.push(...saveForm(outcome));
    } else if (outcome.state === "failed") {
      const reopened = outcome.error === "signed_out" ? null : await saving.open();
      parts.push(...(reopened?.state === "choose" ? saveForm(reopened, outcome) : [savingFailure(outcome)]));
    }
  }

  if (!jobOffer) {
    parts.push(element("p", t("extension.analysis.noJobOffer")));
  } else {
    if (!candidate.signedIn) parts.push(describeJobOffer(jobOffer));
    parts.push(dataNotice(expiresAt), element("h2", t("extension.analysis.cvTitle")));
    if (cv && !changingCv) {
      app.replaceChildren(...parts, status({ text: t("extension.analysis.scoring") }));
      parts.push(...(await matchScore(jobOffer, cv)));
      const actions = element("div", "", "actions");
      actions.append(button(t("extension.analysis.changeCv"), () => void render(undefined, true)));
      parts.push(actions);
    } else {
      parts.push(cvForm());
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

await render();

// Back from signing up or in (or out) on the web app: start again as the person now is, in their
// Interface Language; on sign-up, the Guest's work is kept at once. Checked when the page comes
// back into view and, as a tab switch is not the only way back, every few seconds while it is in view.
const SESSION_CHECK_MS = 3_000;
let reloading = false;
async function checkSession() {
  if (reloading || document.visibilityState !== "visible") return;
  const current = await readCandidateSession(WEB_ORIGIN);
  if (reloading || current.signedIn === candidate.signedIn) return;
  reloading = true;
  location.reload();
}
document.addEventListener("visibilitychange", () => void checkSession());
setInterval(() => void checkSession(), SESSION_CHECK_MS);
