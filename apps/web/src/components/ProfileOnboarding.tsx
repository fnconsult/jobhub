"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MasterCvContent, SearchCriteria } from "@jobhub/shared";
import type { CvDraft } from "@/cv";
import { useAutoGrow } from "@/design/auto-grow";
import { helpLocale } from "@/coach-help";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { CoachBadge, CoachComposer, SendButton, WelcomePanel } from "@/components/CoachBox";
import { HelpIntro } from "@/components/CoachHelp";
import { useConversationFirst } from "@/components/conversation-first";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { InWorkPane } from "@/components/WorkPane";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import {
  answer,
  currentQuestion,
  draftFromQuestionnaire,
  startQuestionnaire,
  type AnswerError,
  type Question,
  type Questionnaire,
} from "@/questionnaire";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { ProfileOnboarding as OnboardingState } from "@/profiles";
import { routes } from "@/routes";
import { BLANK_DRAFT, CvReview, CvUpload, type BornProfile, type ReviewEdits } from "./CvDraftForms";
import { OnboardingSummary } from "./OnboardingSummary";
import { criteriaFieldsOf } from "./SearchCriteriaFields";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";
import "./QuickActions.css";

type From = "cv" | "questionnaire" | "scratch" | "resumed";
/** At the review, the summary first (#1004); `saved` once « Cela semble correct » has saved the Profile, at its page. */
type Step = { kind: "choose" } | { kind: "questionnaire" } | { kind: "review"; draft: CvDraft; from: From; saved?: string };

/** A Profile born during its onboarding and not finished (#999), resumed at its review on `/profils/nouveau?profil=<id>`. */
export interface ResumedProfile extends BornProfile {
  masterCv: MasterCvContent;
  searchCriteria: SearchCriteria;
}

/** The Profile's creation refused by the Plan Quota (409), with its Upgrade Prompt when there is one. */
type Refused = { prompt: Prompt | null };

const IN_PROGRESS: OnboardingState = "in_progress";
const JSON_BODY = { "content-type": "application/json" };

interface Turn {
  question: Question;
  /** What the Candidate answered, as typed ("" when skipped, "yes"/"no" for a yes-or-no question). */
  value: string;
}

/** Where each draft comes from. */
const FROM_CV: From = "cv";
const FROM_SCRATCH: From = "scratch";

/** The review form in the Work Pane: a form, at the page's own address, the draft living in the page. */
const REVIEW: AddressedKind = "form";
const REVIEW_HREF = `${routes.newProfile}#relecture`;
/** A Help Article opened from the welcome panel, in the Work Pane. */
const HELP = "help" as const;

/**
 * Creating a Profile under « Conversation au centre » (ADR-0070): the page is a conversation with the AI Coach, its
 * thread at its reading width, centred, the box at its foot, with the coach's look of every page (#997): the welcome panel,
 * the « Coach IA » badge and « Envoyer au coach » (CoachBox). The Coach's Introduction offers two paths: uploading a CV,
 * a card in the thread (« Partir de zéro » under its drop zone, #468), or answering the Onboarding Questionnaire, the
 * suggestion above the box. The Questionnaire is scripted, so it cannot invent facts: one question at a time in the
 * thread, answered in the box, a yes-or-no question by its suggestions. Either path gives the same draft Master CV and
 * Search Criteria, summed up in plain words by Jobbbox (OnboardingSummary, #1004): « Ai-je bien compris ? ». « Cela semble
 * correct » saves it; « Voir le détail » opens the review form in the Work Pane, where what the Candidate changes is kept
 * while the pane is closed and shows in the summary. No AI replies here, so nothing is stored as a Coach
 * Conversation. Its Activity groups it in one entry, « Création du profil » (#810): the page tells AI Activity the CV read,
 * the Questionnaire's answers and the review as the Candidate goes, and the Profile once saved.
 *
 * The Profile is born as soon as the Questionnaire's target role and location are answered (ADR-0105, #999): created with
 * its onboarding in progress, its id kept by the page; a later answer changing its Search Criteria is saved on it, and the
 * review's save finishes it with one Master CV Version (held here until then). A Profile not finished is `resumed` at its
 * review. From a CV or from scratch, the Profile is still created at the review's save (#1003 changes it).
 */
export function ProfileOnboarding({ resumed }: { resumed?: ResumedProfile }) {
  const { t } = useTranslation();
  const id = useId();
  const pane = useWorkPane();
  const noteCreation = useAiActivityLive()?.noteCreation;
  const [step, setStep] = useState<Step>(() =>
    resumed ? { kind: "review", draft: { masterCv: resumed.masterCv, searchCriteria: resumed.searchCriteria }, from: "resumed" } : { kind: "choose" },
  );
  // The Profile born during the onboarding, once its creation has answered (null: none, or refused); kept across « Recommencer ».
  const [bornAtStart] = useState(() => (resumed ? Promise.resolve<BornProfile | null>({ id: resumed.id, version: resumed.version }) : null));
  const born = useRef<Promise<BornProfile | null> | null>(bornAtStart);
  // The Search Criteria last sent for it, so that only an answer changing them is saved.
  const sentCriteria = useRef(resumed ? criteriaKey(resumed.searchCriteria) : "");
  const [refused, setRefused] = useState<Refused | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(startQuestionnaire);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  // What the Candidate sent to start the questions, if they typed it rather than chose the suggestion.
  const [opener, setOpener] = useState("");
  // What the Candidate sent outside a question, each answered by a line sending them back to the review.
  const [asides, setAsides] = useState<string[]>([]);
  const [error, setError] = useState<AnswerError | null>(null);
  // Each opening of the review form (« Voir le détail ») mounts it afresh in the Work Pane, none until the first; what was
  // changed in it is kept here meanwhile.
  const [reviewOpening, setReviewOpening] = useState(0);
  const [edits, setEdits] = useState<ReviewEdits | null>(() =>
    resumed ? { masterCv: resumed.masterCv, criteria: criteriaFieldsOf(resumed.searchCriteria) } : null,
  );
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, value);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const question = step.kind === "questionnaire" ? currentQuestion(questionnaire) : null;
  const reviewShown = pane?.item?.kind === REVIEW && pane.item.href === REVIEW_HREF;

  // A creation starts afresh with the page; one resumed is at its review.
  const resumedId = resumed?.id;
  useEffect(() => {
    noteCreation?.({ type: "started" });
    if (resumedId) noteCreation?.({ type: "reviewed" });
  }, [noteCreation, resumedId]);

  // The next question takes the focus: the box, or a yes-or-no question's first answer.
  useEffect(() => {
    if (step.kind !== "questionnaire") return;
    (question?.kind === "yesNo" ? firstChoice.current : box.current)?.focus();
  }, [step.kind, turns.length, question?.kind]);

  function review(draft: CvDraft, from: From) {
    if (from === FROM_CV) noteCreation?.({ type: "read", provenance: draft.provenance ?? null });
    noteCreation?.({ type: "reviewed" });
    setEdits(null);
    setStep({ kind: "review", draft, from });
  }

  function saved(href: string) {
    noteCreation?.({ type: "saved", href });
  }

  /** « Cela semble correct » saved the Profile: the coach says so in the thread, and the review form closes. */
  function confirmed(href: string) {
    saved(href);
    setStep((current) => (current.kind === "review" ? { ...current, saved: href } : current));
  }

  function askQuestionnaire(said = "") {
    setOpener(said);
    setValue("");
    setStep({ kind: "questionnaire" });
    noteCreation?.({ type: "answered", answered: 0, skipped: 0 });
  }

  function startOver() {
    noteCreation?.({ type: "started" });
    setStep({ kind: "choose" });
    setQuestionnaire(startQuestionnaire());
    setTurns([]);
    setValue("");
    setError(null);
    setEdits(null);
    setOpener("");
    setAsides([]);
    setRefused(null);
    setReviewOpening(0);
  }

  /**
   * Once the target role and a location are answered (#999), the Profile is born with the draft so far, its onboarding in
   * progress; once born, an answer changing them changes its Search Criteria. Each waits for the one before. A creation
   * refused leaves no Profile, tried again only when they change: the review's save creates it, or shows why not.
   */
  function keepCriteria(draft: CvDraft) {
    const { searchCriteria } = draft;
    const key = criteriaKey(searchCriteria);
    if (!searchCriteria.targetRole || searchCriteria.locations.length === 0 || key === sentCriteria.current) return;
    sentCriteria.current = key;
    born.current = (born.current ?? Promise.resolve(null)).then(async (profile) => {
      if (!profile) return createProfile(draft);
      await fetch(`/api/profiles/${profile.id}`, { method: "PATCH", headers: JSON_BODY, body: JSON.stringify({ searchCriteria }) }).catch(() => null);
      return profile;
    });
  }

  async function createProfile(draft: CvDraft): Promise<BornProfile | null> {
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: JSON_BODY,
        body: JSON.stringify({ masterCv: draft.masterCv, searchCriteria: draft.searchCriteria, onboarding: IN_PROGRESS }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201 && typeof body.id === "string") {
        noteCreation?.({ type: "created", href: routes.masterCvVersion(body.id, 1) });
        return { id: body.id, version: 1 };
      }
      if (body.error === "plan_quota_reached") setRefused({ prompt: upgradePromptIn(body) });
    } catch {
      // Not born: the review's save creates it.
    }
    return null;
  }

  function reply(given: string) {
    if (!question) return;
    const result = answer(questionnaire, given);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const answered = [...turns, { question, value: given.trim() }];
    setTurns(answered);
    noteCreation?.({ type: "answered", answered: answered.filter((turn) => turn.value !== "").length, skipped: answered.filter((turn) => turn.value === "").length });
    setQuestionnaire(result.questionnaire);
    setValue("");
    setError(null);
    const draft = draftFromQuestionnaire(result.questionnaire);
    keepCriteria(draft);
    if (!currentQuestion(result.questionnaire)) review(draft, "questionnaire");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const given = value.trim();
    // Before any question, what is sent starts the questions, as the Candidate's opening line.
    if (step.kind === "choose") {
      if (given) askQuestionnaire(given);
      return;
    }
    // A yes-or-no question also takes « oui » / « non » typed in the box.
    if (question?.kind === "yesNo") {
      reply(yesOrNo(given, t("questionnaire.yes"), t("questionnaire.no")) ?? given);
      return;
    }
    if (question) {
      reply(value);
      return;
    }
    // At the review, the scripted coach can only send the Candidate back to it: no AI answers on this page.
    if (given) {
      setAsides((said) => [...said, given]);
      setValue("");
    }
  }

  const questionText = (asked: Question) => t(`questionnaire.questions.${asked.id}`, { number: asked.number ?? 1 });
  const answerText = (turn: Turn) =>
    turn.question.kind === "yesNo" ? t(turn.value === "yes" ? "questionnaire.yes" : "questionnaire.no") : turn.value || t("questionnaire.skipped");
  const startOverLabel = step.kind === "review" && step.from === "questionnaire" ? t("questionnaire.startOver") : t("cvReview.startOver");
  const answering = step.kind === "questionnaire" || (step.kind === "review" && step.from === "questionnaire");
  const described = [question?.optional ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

  const asking = question !== null;
  const boxLabel = asking ? t("questionnaire.answerLabel") : t("coachPanel.messageLabel");

  return (
    <>
      <section className="page-conversation" aria-label={t("newProfile.conversation")}>
        <div className="page-conversation-thread">
          <ol className="chat coach-panel-messages" aria-label={t("questionnaire.transcript")} aria-live="polite">
            <OnboardingWelcome />
            {step.kind === "choose" ? (
              <li className="chat-message chat-card">
                <Card title={t("newProfile.withCv")}>
                  <p>{t("cvUpload.intro")}</p>
                  <CvUpload onDraft={(draft) => review(draft, FROM_CV)} onFromScratch={() => review(BLANK_DRAFT, FROM_SCRATCH)} />
                </Card>
              </li>
            ) : null}
            {answering ? (
              <>
                <li className="chat-message chat-candidate">
                  <span className="visually-hidden">{t("questionnaire.you")}</span>
                  <p>{opener || t("newProfile.startQuestionnaire")}</p>
                </li>
                <CoachLine>
                  <p>{t("newProfile.questionsStart")}</p>
                </CoachLine>
                {turns.flatMap((turn, index) => [
                  <CoachLine key={`question-${index}`}>
                    <p>{questionText(turn.question)}</p>
                  </CoachLine>,
                  <li key={`answer-${index}`} className="chat-message chat-candidate">
                    <span className="visually-hidden">{t("questionnaire.you")}</span>
                    <p>{answerText(turn)}</p>
                  </li>,
                ])}
              </>
            ) : null}
            {refused ? (
              <li className="chat-message chat-card">
                {refused.prompt ? (
                  <UpgradePrompt prompt={refused.prompt} />
                ) : (
                  <p className="notice" role="alert">
                    {t("profiles.quotaReached")}
                  </p>
                )}
              </li>
            ) : null}
            {question ? (
              <CoachLine>
                <p>{questionText(question)}</p>
              </CoachLine>
            ) : null}
            {step.kind === "review" && step.from === "resumed" ? (
              <CoachLine>
                <p>{t("newProfile.resumeIntro")}</p>
              </CoachLine>
            ) : null}
            {step.kind === "review" ? (
              <OnboardingSummary
                draft={step.draft}
                edits={edits}
                born={() => born.current ?? Promise.resolve(null)}
                onDetail={() => setReviewOpening((opening) => opening + 1)}
                onSaved={confirmed}
              />
            ) : null}
            {asides.map((aside, index) => [
              <li key={`aside-${index}`} className="chat-message chat-candidate">
                <span className="visually-hidden">{t("questionnaire.you")}</span>
                <p>{aside}</p>
              </li>,
              <CoachLine key={`aside-reply-${index}`}>
                <p>{t("newProfile.reviewOnly")}</p>
              </CoachLine>,
            ])}
          </ol>
        </div>
        <div className="page-conversation-foot">
          {step.kind === "choose" ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => askQuestionnaire()}>
                {t("newProfile.startQuestionnaire")}
              </button>
            </Suggestions>
          ) : null}
          {step.kind === "review" && !step.saved && !reviewShown ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={startOver}>
                {startOverLabel}
              </button>
            </Suggestions>
          ) : null}
          {question?.kind === "yesNo" ? (
            <Suggestions label={t("questionnaire.answerLabel")}>
              <button ref={firstChoice} className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => reply("yes")}>
                {t("questionnaire.yes")}
              </button>
              <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={() => reply("no")}>
                {t("questionnaire.no")}
              </button>
            </Suggestions>
          ) : question?.optional ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={() => reply("")}>
                {t("questionnaire.skip")}
              </button>
            </Suggestions>
          ) : null}
          {/* The box of every conversation (#997): « Envoyer au coach », the « Coach IA » badge in it. */}
          <form className="coach-panel-form coach-panel-form-inline" onSubmit={submit} noValidate>
            <label className="visually-hidden" htmlFor={id}>
              {boxLabel}
            </label>
            {question?.optional ? (
              <p id={`${id}-hint`} className="hint">
                {t("questionnaire.answerHint")}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} className="field-error" role="alert">
                {t(`questionnaire.errors.${error}`)}
              </p>
            ) : null}
            <CoachComposer
              inputRef={box}
              writing={value !== ""}
              textarea={
                <textarea
                  id={id}
                  ref={box}
                  rows={1}
                  placeholder={boxLabel}
                  value={value}
                  required={asking && question.kind !== "yesNo" && !question.optional}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={described}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends, as in every conversation's box; Shift+Enter starts a new line.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              }
              badge={<OnboardingBadge />}
              action={<SendButton />}
            />
          </form>
        </div>
      </section>
      {step.kind === "review" && !step.saved && reviewOpening > 0 ? (
        <InWorkPane key={reviewOpening} kind={REVIEW} title={t("cvReview.title")} href={REVIEW_HREF} back={routes.newProfile}>
          <CvReview
            draft={step.draft}
            {...(edits ? { kept: edits } : {})}
            onKeep={setEdits}
            startOverLabel={startOverLabel}
            onStartOver={startOver}
            born={() => born.current ?? Promise.resolve(null)}
            onSaved={saved}
          />
        </InWorkPane>
      ) : null}
    </>
  );
}

/** The page's Introduction, in the welcome panel and in the « Coach IA » badge's dialog. */
function OnboardingIntroduction() {
  const { t } = useTranslation();
  return (
    <>
      <p>{t("newProfile.intro")}</p>
      <p>{t("newProfile.withoutCvIntro")}</p>
    </>
  );
}

/** The help under the Introduction, as on every conversation: a Help Article opens in the Work Pane. */
function OnboardingHelp({ onOpen }: { onOpen?: () => void }) {
  const { i18n } = useTranslation();
  const pathname = usePathname();
  const pane = useWorkPane();
  return (
    <HelpIntro
      pathname={pathname}
      locale={helpLocale(i18n.language)}
      howThisPageWorks={pane !== null}
      oftenAsked={false}
      onOpen={(article) => {
        onOpen?.();
        pane?.open({ kind: HELP, article });
      }}
    />
  );
}

/** The welcome panel of every conversation (#652): AI disclosure, the page's Introduction, the help; closed for good by its ✕. */
export function OnboardingWelcome() {
  const welcome = useConversationFirst()?.welcome ?? null;
  if (welcome?.closed) return null;
  return (
    <WelcomePanel {...(welcome ? { onClose: welcome.close } : {})}>
      <OnboardingIntroduction />
      <OnboardingHelp />
    </WelcomePanel>
  );
}

/** The « Coach IA » badge, which opens the welcome panel again in a dialog. */
function OnboardingBadge() {
  const [open, setOpen] = useState(false);
  return (
    <CoachBadge open={open} onOpenChange={setOpen}>
      <OnboardingIntroduction />
      <OnboardingHelp onOpen={() => setOpen(false)} />
    </CoachBadge>
  );
}

/** One of the AI Coach's lines in the thread: unframed text, its author heard by screen readers only (#317). */
function CoachLine({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {children}
    </li>
  );
}

/** Suggestions above the box, as on every page that is a conversation. */
function Suggestions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="page-conversation-suggestions" role="group" aria-label={label}>
      <div className="quick-actions">{children}</div>
    </div>
  );
}

/** The target role and locations the Profile is born with, as one key: a change of either is saved on it (#999). */
function criteriaKey(criteria: Pick<SearchCriteria, "targetRole" | "locations">): string {
  return JSON.stringify([criteria.targetRole, criteria.locations]);
}

/** « oui », « Non », « yes »… typed for a yes-or-no question: "yes" or "no", or null when it is neither. */
function yesOrNo(given: string, yes: string, no: string): "yes" | "no" | null {
  const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[.!]+$/, "").trim().toLowerCase();
  const said = plain(given);
  if (said === plain(yes) || said === "yes" || said === "oui") return "yes";
  if (said === plain(no) || said === "no" || said === "non") return "no";
  return null;
}
