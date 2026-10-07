import { designTokens, renderDesignCss } from "@jobhub/shared/design";
import { createI18n } from "@jobhub/shared/i18n";
import type { CvContent, JobOffer } from "@jobhub/shared";
import { browser } from "wxt/browser";
import { readCandidateSession } from "../../src/candidate-session";
import { createGuestSession } from "../../src/guest-session";
import { createJobbboxApi } from "../../src/jobbbox-api";
import { describeMatchScore } from "../../src/match-score-view";
import { WEB_ORIGIN } from "../../src/web-app";
import "./analyse.css";

// The analysis page: the captured Job Offer, the Guest's CV and their Match Score.
const style = document.createElement("style");
style.textContent = renderDesignCss(designTokens);
document.head.append(style);

const candidate = await readCandidateSession(WEB_ORIGIN);
const i18n = createI18n(candidate.signedIn ? candidate.candidate.interfaceLanguage : undefined);
const { t } = i18n;
document.documentElement.lang = i18n.language;
document.title = `${t("extension.analysis.title")} – Jobbbox`;

const session = createGuestSession(browser.storage.session);
const api = createJobbboxApi(WEB_ORIGIN);
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

function guestNotice(expiresAt: number | undefined): HTMLElement {
  const notice = element("div", "", "notice");
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
  form.append(label, hint, input, submit, progress);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) return;
    submit.disabled = true;
    progress.textContent = t("cvUpload.reading");
    const read = await api.readCv(file);
    if (!read.ok) {
      submit.disabled = false;
      progress.textContent = "";
      const text = read.error === "unreachable" ? t("extension.unreachable") : t(`cvUpload.errors.${read.error}`);
      form.after(status({ text, error: true }));
      return;
    }
    await session.keepCv(read.cv);
    await render();
  });
  return form;
}

async function matchScore(jobOffer: JobOffer, cv: CvContent): Promise<HTMLElement[]> {
  const scored = await api.score(jobOffer.id, cv);
  if (!scored.ok) {
    const text = scored.error === "job_offer_gone" ? t("extension.analysis.jobOfferGone") : t("extension.unreachable");
    return [status({ text, error: true })];
  }
  const view = describeMatchScore(scored.matchScore, t);
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

async function render(message?: Message, changingCv = false) {
  const { jobOffer, cv, expiresAt } = await session.read();
  const parts: (HTMLElement | string)[] = [element("h1", t("extension.analysis.title"))];
  if (message) parts.push(status(message));

  if (!jobOffer) {
    parts.push(element("p", t("extension.analysis.noJobOffer")));
  } else {
    parts.push(describeJobOffer(jobOffer), guestNotice(expiresAt), element("h2", t("extension.analysis.cvTitle")));
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
    const signUp = element("a", t("extension.analysis.signUp"));
    Object.assign(signUp, { href: `${WEB_ORIGIN}/connexion`, target: "_blank", rel: "noopener" });
    const paragraph = element("p");
    paragraph.append(signUp);
    parts.push(paragraph);
  }
  app.replaceChildren(...parts);
}

await render();
