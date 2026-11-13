"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { ContractType, MasterCvContent, Provenance, RemoteWork, SearchCriteria } from "@jobhub/shared";
import type { CvDraft } from "@/cv";
import { useAutoGrow } from "@/design/auto-grow";
import { helpLocale, onThisPage } from "@/coach-help";
import { useHelpSettings } from "@/coach-help/settings";
import { useShowInActivity } from "@/components/AiActivity";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { CoachBadge, CoachComposer, SendButton, WelcomePanel } from "@/components/CoachBox";
import { useConversationFirst } from "@/components/conversation-first";
import { StreamedActionStatus, useStreamedAction } from "@/components/StreamedAction";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { InWorkPane } from "@/components/WorkPane";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import {
  answerCounts,
  foldedProvenance,
  interviewDraft,
  questionnaireDraft,
  replied,
  REQUIRED_FIELDS,
  type CvRead,
  type ExchangeTurn,
  type InterviewDraft,
  type InterviewField,
  type InterviewReply,
  type InterviewTurn,
} from "@/onboarding-interview/turn";
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
import type { RefiningCriterion } from "@/ai-activity/followed-search";
import { CoachLine, InActivity } from "./CoachLine";
import { CvReadingCard, CvReadLine } from "./CvReadingCard";
import { searchedWith, useFollowedSearch } from "./followed-search";
import { OnboardingSummary } from "./OnboardingSummary";
import { criteriaFieldsOf } from "./SearchCriteriaFields";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";
import "./QuickActions.css";

type From = "cv" | "interview" | "questionnaire" | "resumed";
/** At the review, the summary first (#1004); `saved` once « Cela semble correct » has saved the Profile, at its page. */
/** `reading`: the CV read (#1003), its fields appearing on « Profil en construction » before the interview starts from it. */
type Step =
  | { kind: "choose" }
  | { kind: "reading"; draft: CvDraft }
  | { kind: "interview" }
  | { kind: "questionnaire" }
  | { kind: "review"; draft: CvDraft; from: From; saved?: string };

/** A Profile born during its onboarding and not finished (#999), resumed at its review on `/profils/nouveau?profil=<id>`. */
export interface ResumedProfile extends BornProfile {
  masterCv: MasterCvContent;
  searchCriteria: SearchCriteria;
}

/** The Profile's creation refused by the Plan Quota (409), with its Upgrade Prompt when there is one. */
type Refused = { prompt: Prompt | null };

/**
 * The AI Coach's interview (#1002): the draft made of what the Candidate answered or validated, the turns answered, the
 * turn waiting for its reply (null while the next one is asked), its Provenance so far, and whether the Candidate said
 * « Non, plutôt… » to its proposal.
 */
interface Interview {
  draft: InterviewDraft;
  exchange: ExchangeTurn[];
  turn: InterviewTurn | null;
  provenance: Provenance | null;
  declining: boolean;
  /** With a CV (#1003): the target role and places it read, to confirm, sent with each turn asked. */
  cv?: CvRead;
}

const IN_PROGRESS: OnboardingState = "in_progress";
/** The Job Searches the onboarding offers a Profile (#1000): its first, and one restart. */
const OFFERED_SEARCHES = 2;
const JSON_BODY = { "content-type": "application/json" };
const INTERVIEW_URL = "/api/onboarding/interview";

interface Turn {
  question: Question;
  /** What the Candidate answered, as typed ("" when skipped, "yes"/"no" for a yes-or-no question). */
  value: string;
}

/** Where each draft comes from. */
const FROM_CV: From = "cv";

/** The review form in the Work Pane: a form, at the page's own address, the draft living in the page. */
const REVIEW: AddressedKind = "form";
const REVIEW_HREF = `${routes.newProfile}#relecture`;
/** A Help Article opened from the welcome panel, in the Work Pane. */
const HELP = "help" as const;

const newInterview = (): Interview => ({ draft: interviewDraft(BLANK_DRAFT), exchange: [], turn: null, provenance: null, declining: false });

/**
 * Creating a Profile under « Conversation au centre » (ADR-0070): the page is a conversation with the AI Coach, its
 * thread at its reading width, centred, the box at its foot, with the coach's look of every page (#997): the welcome panel,
 * the « Coach IA » badge and « Envoyer au coach » (CoachBox). The Coach's Introduction offers two paths: uploading a CV,
 * a card in the thread (#468), or answering the coach's questions, the suggestion above the box, which replaced « Partir de
 * zéro » (#1006). Either path gives the same draft Master CV and Search Criteria, summed up in plain words by Jobbbox
 * (OnboardingSummary, #1004): « Ai-je bien compris ? ». « Cela semble correct » saves it; « Voir le détail » opens the
 * review form in the Work Pane, where what the Candidate changes is kept while the pane is closed and shows in the
 * summary. Its Activity groups it in one entry, « Création du profil » (#810): the page tells AI Activity the CV read,
 * the interview's turns, the answers and the review as the Candidate goes, and the Profile once saved.
 *
 * Without a CV, the AI Coach leads the interview (ADR-0106, #1002): one question at a time from `/api/onboarding/interview`,
 * in the thread; a vague answer challenged; a deduction proposed as suggestions, « Oui, … » and « Non, plutôt… »; a choice
 * by its options; « Passer » on what is optional; the answers through the box. Only what the Candidate answers or validates
 * enters the draft (ADR-0006, `replied`): a proposal answered otherwise, or not at all, never does. The exchange is not kept
 * as a Coach Conversation. When the AI cannot give the next turn (it fails, it is stopped, its reply is unusable), the
 * scripted Onboarding Questionnaire takes over at the next question, skipping what is already known: no dead end.
 *
 * With a CV (#1003), « Profil en construction » shows the reading in the thread (CvReadingCard): « Lecture de votre
 * profil » under way while `/api/cv/draft` reads it, then the fields it read appearing one by one, an absent one said
 * absent; then it folds into one line, « Profil construit à partir de votre CV · N informations lues », and the interview
 * starts from the CV's draft: the target role and places it read proposed to confirm, then only what a CV does not say
 * (contracts, remote work, minimum salary), each skippable.
 *
 * The Profile is born as soon as its target role and location are answered or confirmed (ADR-0106, #999): created with its
 * onboarding in progress, its id kept by the page; a later answer changing its Search Criteria is saved on it, and the
 * review's save finishes it with one Master CV Version (held here until then). A Profile not finished is `resumed` at its
 * review.
 * Born, it gets its first Job Search, offered outside the Plan Quota (#1000), started again once when an answer changes
 * its target role or locations; a coach line in the thread says so, text only. Its progress is AI Activity's: the page
 * follows it (useFollowedSearch), so « En ce moment » counts it « ici », with its run's measures and the Job Offers that
 * match the criteria of the moment, and keeps it in the history once over (#1001). Once « Cela semble correct » has saved
 * the Profile, a coach line says the first offers are there and opens Activity on it (#1006).
 */
export function ProfileOnboarding({ resumed }: { resumed?: ResumedProfile }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const pane = useWorkPane();
  const noteCreation = useAiActivityLive()?.noteCreation;
  const asking = useStreamedAction("onboarding_interview");
  const [step, setStep] = useState<Step>(() =>
    resumed ? { kind: "review", draft: { masterCv: resumed.masterCv, searchCriteria: resumed.searchCriteria }, from: "resumed" } : { kind: "choose" },
  );
  // The Profile born during the onboarding, once its creation has answered (null: none, or refused); kept across « Recommencer ».
  const [bornAtStart] = useState(() => (resumed ? Promise.resolve<BornProfile | null>({ id: resumed.id, version: resumed.version }) : null));
  const born = useRef<Promise<BornProfile | null> | null>(bornAtStart);
  // The Search Criteria last sent for it, so that only an answer changing them is saved.
  const sentCriteria = useRef(resumed ? criteriaKey(resumed.searchCriteria) : "");
  // Its target role and locations last sent: only a change of them starts the offered Job Search again (#1000).
  const sentTarget = useRef(resumed ? targetKey(resumed.searchCriteria) : "");
  const [refused, setRefused] = useState<Refused | null>(null);
  const [interview, setInterview] = useState<Interview>(newInterview);
  // The interview gave way to the scripted questions (the AI unavailable): they start from what it had.
  const [fellBack, setFellBack] = useState(false);
  // The Job Search the onboarding offers (#1000), once started: told in the thread after the answer that started it
  // (`after`: how many answers then, the interview's and then the scripted questions'); and how many times it was asked for.
  const [offeredSearch, setOfferedSearch] = useState<{ restarted: boolean; after: number } | null>(null);
  const offeredStarts = useRef(0);
  // The offered Job Search the page follows in AI Activity (#1001): the latest started, kept when the Candidate starts over.
  const [followed, setFollowed] = useState<{ id: string; profileId: string } | null>(null);
  // The CV read (#1003): its draft once `/api/cv/draft` gave it, kept for the line the reading card folds into; and
  // whether it is being read, for the card to show its step under way.
  const [cvRead, setCvRead] = useState<CvDraft | null>(null);
  const [cvReading, setCvReading] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(startQuestionnaire);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  // What the Candidate sent to start the questions, if they typed it rather than chose the suggestion.
  const [opener, setOpener] = useState("");
  // What the Candidate sent outside a question, each answered by a line sending them back to the review, or, once the
  // Profile is saved (« Cela semble correct »), on to it (`saved`).
  const [asides, setAsides] = useState<{ text: string; saved: boolean }[]>([]);
  const [error, setError] = useState<AnswerError | null>(null);
  // Each opening of the review form (« Voir le détail ») mounts it afresh in the Work Pane, none until the first; what was
  // changed in it is kept here meanwhile.
  const [reviewOpening, setReviewOpening] = useState(0);
  const [edits, setEdits] = useState<ReviewEdits | null>(() =>
    resumed ? { masterCv: resumed.masterCv, criteria: criteriaFieldsOf(resumed.searchCriteria) } : null,
  );
  // Each start of the questions (and « Recommencer ») is a run of its own: a turn asked by an earlier one is dropped.
  const run = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, value);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const question = step.kind === "questionnaire" ? currentQuestion(questionnaire) : null;
  const turn = step.kind === "interview" && !asking.running ? interview.turn : null;
  // « Passer » never on the target role or a place, whatever the AI says (#999, #1002): the Profile is born at them.
  const turnOptional = turn ? skippable(turn) : false;
  const reviewShown = pane?.item?.kind === REVIEW && pane.item.href === REVIEW_HREF;
  const language = i18n.language === "en" ? "en" : "fr";

  // A creation starts afresh with the page; one resumed is at its review.
  const resumedId = resumed?.id;
  useEffect(() => {
    noteCreation?.({ type: "started" });
    if (resumedId) noteCreation?.({ type: "reviewed" });
  }, [noteCreation, resumedId]);

  // The next question takes the focus: the box, or a question's first suggestion (a yes-or-no, a proposal, a choice).
  const suggested = question?.kind === "yesNo" || Boolean(turn && (turn.proposal || turn.ask.kind === "choice") && !interview.declining);
  useEffect(() => {
    if (step.kind !== "questionnaire" && step.kind !== "interview") return;
    (suggested ? firstChoice.current : box.current)?.focus();
  }, [step.kind, turns.length, question?.kind, turn, suggested, interview.declining]);

  function review(draft: CvDraft, from: From, kept: ReviewEdits | null = null) {
    noteCreation?.({ type: "reviewed" });
    setEdits(kept);
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

  /** The CV read (#1003): « Profil en construction » shows its fields, then the interview starts from it (`startFromCv`). */
  function read(draft: CvDraft) {
    noteCreation?.({ type: "read", provenance: draft.provenance ?? null });
    setCvRead(draft);
    setStep({ kind: "reading", draft });
  }

  /**
   * The interview from the CV read (#1003): its Master CV in the draft, its target role and places only to confirm, not in
   * it until the Candidate does (« Oui, … »); then only what a CV does not say. No opening line: the CV said it.
   */
  function startFromCv(draft: CvDraft) {
    setOpener("");
    setValue("");
    const started: Interview = {
      ...newInterview(),
      draft: interviewDraft({ masterCv: draft.masterCv, searchCriteria: { targetRole: "", locations: [] } }),
      cv: { targetRole: draft.searchCriteria.targetRole, locations: draft.searchCriteria.locations },
    };
    setInterview(started);
    setStep({ kind: "interview" });
    noteCreation?.({ type: "interviewed", answered: 0, skipped: 0, provenance: null });
    void askNext(started, "");
  }

  /** The questions start: the AI Coach's interview, its first turn asked at once. */
  function startQuestions(said = "") {
    setOpener(said);
    setValue("");
    const started = newInterview();
    setInterview(started);
    setStep({ kind: "interview" });
    noteCreation?.({ type: "interviewed", answered: 0, skipped: 0, provenance: null });
    void askNext(started, said);
  }

  /**
   * Asks the AI Coach for the next turn, after the exchange so far; done, the review follows. Without a turn (the AI
   * failed, it was stopped, its reply was not usable), the scripted questions take over at the next question.
   */
  async function askNext(now: Interview, said = opener) {
    const mine = ++run.current;
    const outcome = await asking.run(INTERVIEW_URL, {
      method: "POST",
      json: { language, draft: now.draft, exchange: now.exchange, ...(said ? { opener: said } : {}), ...(now.cv ? { cv: now.cv } : {}) },
    });
    if (mine !== run.current) return;
    const next = outcome.ok ? (outcome.body.turn as InterviewTurn | undefined) : undefined;
    if (!next) return fallBack(now);
    const provenance = foldedProvenance(now.provenance, (outcome.body.provenance as Provenance | null | undefined) ?? null);
    noteCreation?.({ type: "interviewed", ...answerCounts(now.exchange), provenance });
    if (next.done) {
      setInterview({ ...now, turn: null, provenance });
      // From a CV, its draft keeps what read it (#335), saved with the Master CV's first version.
      if (now.cv) return review({ ...questionnaireDraft(now.draft), ...(cvRead?.provenance ? { provenance: cvRead.provenance } : {}) }, FROM_CV, reviewEditsOf(now.draft));
      return review(questionnaireDraft(now.draft), "interview", reviewEditsOf(now.draft));
    }
    setInterview({ ...now, turn: next, provenance, declining: false });
  }

  /** The scripted questions take over from the interview's draft (#1002): what it knows is not asked again. */
  function fallBack(now: Interview) {
    setFellBack(true);
    const scripted = startQuestionnaire(questionnaireDraft(now.draft));
    setQuestionnaire(scripted);
    setTurns([]);
    if (!currentQuestion(scripted)) return review(questionnaireDraft(now.draft), "interview", reviewEditsOf(now.draft));
    setStep({ kind: "questionnaire" });
    noteCreation?.({ type: "answered", answered: 0, skipped: 0 });
  }

  /** The Candidate's reply to the turn: only their answer, or the proposal they validated, enters the draft; then the next turn. */
  function replyToTurn(reply: InterviewReply) {
    const current = interview.turn;
    if (!current || asking.running) return;
    if (reply.kind === "answer" && !reply.text.trim() && reply.choice === undefined) {
      if (!skippable(current)) setError("required");
      return;
    }
    const draft = replied(interview.draft, current, reply);
    const said: ExchangeTurn = {
      ask: { field: current.ask.field, question: current.ask.question },
      ...(current.proposal ? { proposal: { field: current.proposal.field, value: current.proposal.value, shown: current.proposal.shown } } : {}),
      ...(current.challenge ? { challenge: current.challenge } : {}),
      reply: reply.kind === "answer" ? { ...reply, text: reply.text.trim(), ...(interview.declining ? { declined: true } : {}) } : reply,
    };
    const now: Interview = { ...interview, draft, exchange: [...interview.exchange, said], turn: null, declining: false };
    setInterview(now);
    setValue("");
    setError(null);
    noteCreation?.({ type: "interviewed", ...answerCounts(now.exchange), provenance: now.provenance });
    keepCriteria(draft.masterCv, draft.searchCriteria, now.exchange.length);
    void askNext(now);
  }

  function startOver() {
    run.current++;
    asking.stop();
    noteCreation?.({ type: "started" });
    setStep({ kind: "choose" });
    setInterview(newInterview());
    setFellBack(false);
    setQuestionnaire(startQuestionnaire());
    setTurns([]);
    setValue("");
    setError(null);
    setEdits(null);
    setOpener("");
    setAsides([]);
    setRefused(null);
    setReviewOpening(0);
    setOfferedSearch(null);
    setCvRead(null);
    setCvReading(false);
  }

  /**
   * Once the target role and a location are answered (#999), the Profile is born with the draft so far, its onboarding in
   * progress; once born, an answer changing its Search Criteria changes them. Each waits for the one before. A creation
   * refused leaves no Profile, tried again only when they change: the review's save creates it, or shows why not.
   */
  function keepCriteria(masterCv: MasterCvContent, searchCriteria: CvDraft["searchCriteria"] & Partial<SearchCriteria>, after: number) {
    const key = criteriaKey(searchCriteria);
    if (!searchCriteria.targetRole || searchCriteria.locations.length === 0 || key === sentCriteria.current) return;
    sentCriteria.current = key;
    const retargeted = targetKey(searchCriteria) !== sentTarget.current;
    sentTarget.current = targetKey(searchCriteria);
    born.current = (born.current ?? Promise.resolve(null)).then(async (profile) => {
      if (!profile) {
        const created = await createProfile(masterCv, searchCriteria);
        if (created) await startOfferedSearch(created.id, after);
        return created;
      }
      const changed = await fetch(`/api/profiles/${profile.id}`, { method: "PATCH", headers: JSON_BODY, body: JSON.stringify({ searchCriteria }) }).catch(() => null);
      // The search follows the new target role or locations: started again, once (#1000); not another criterion (#1002).
      if (changed?.ok && retargeted) await startOfferedSearch(profile.id, after);
      return profile;
    });
  }

  /**
   * Starts the Job Search the onboarding offers the Profile born (ADR-0106, #1000), outside the Plan Quota, then starts it
   * again once when its target role or locations change; the server refuses beyond (409), so no more is asked. Not
   * started, the onboarding goes on: the Candidate can still search from Recherches d'offres.
   */
  async function startOfferedSearch(profileId: string, after: number): Promise<void> {
    if (offeredStarts.current >= OFFERED_SEARCHES) return;
    offeredStarts.current += 1;
    try {
      const response = await fetch(`/api/profiles/${profileId}/onboarding-search`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201 && typeof body.id === "string") {
        setOfferedSearch({ restarted: body.offered === "restart", after });
        setFollowed({ id: body.id, profileId });
      }
      else if (response.status === 409) offeredStarts.current = OFFERED_SEARCHES;
    } catch {
      // Not started: nothing to tell.
    }
  }

  async function createProfile(masterCv: MasterCvContent, searchCriteria: CvDraft["searchCriteria"]): Promise<BornProfile | null> {
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: JSON_BODY,
        // From a CV, what read it (#335), kept with the Master CV's first version.
        body: JSON.stringify({ masterCv, searchCriteria, onboarding: IN_PROGRESS, ...(cvRead?.provenance ? { provenance: cvRead.provenance } : {}) }),
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

  /** The scripted questions' draft, with the Search Criteria the interview had before they took over (contracts, Sectors…). */
  function scriptedDraft(scripted: Questionnaire): CvDraft & { searchCriteria: Partial<SearchCriteria> } {
    const draft = draftFromQuestionnaire(scripted);
    return fellBack ? { ...draft, searchCriteria: { ...interview.draft.searchCriteria, ...draft.searchCriteria } } : draft;
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
    const draft = scriptedDraft(result.questionnaire);
    keepCriteria(draft.masterCv, draft.searchCriteria, interview.exchange.length + answered.length);
    if (!currentQuestion(result.questionnaire)) review(draftFromQuestionnaire(result.questionnaire), "questionnaire", fellBack ? reviewEditsOf(interviewDraft(draft)) : null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const given = value.trim();
    // Before any question, what is sent starts the questions, as the Candidate's opening line.
    if (step.kind === "choose") {
      if (given) startQuestions(given);
      return;
    }
    if (step.kind === "interview") {
      replyToTurn({ kind: "answer", text: value });
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
    // At the review, the coach can only send the Candidate back to it, or on to the Profile saved: it answers nothing else here.
    if (given) {
      setAsides((said) => [...said, { text: given, saved: step.kind === "review" && Boolean(step.saved) }]);
      setValue("");
    }
  }

  const questionText = (asked: Question) => t(`questionnaire.questions.${asked.id}`, { number: asked.number ?? 1 });
  const answerText = (turn: Turn) =>
    turn.question.kind === "yesNo" ? t(turn.value === "yes" ? "questionnaire.yes" : "questionnaire.no") : turn.value || t("questionnaire.skipped");
  const choiceLabel = (field: InterviewField, choice: string) =>
    field === "contractTypes" ? t(`cvReview.contractTypes.${choice as ContractType}`) : field === "remoteWorkOptions" ? t(`cvReview.remoteWorkOptions.${choice as RemoteWork}`) : choice;
  const replyText = (said: ExchangeTurn) => {
    const { reply: given } = said;
    if (given.kind === "skipped") return t("questionnaire.skipped");
    if (given.kind === "accepted") return t("newProfile.interview.yes", { value: said.proposal?.shown ?? "" });
    return given.choice !== undefined ? choiceLabel(said.ask.field, given.choice) : given.text;
  };
  const fromQuestions = step.kind === "review" && (step.from === "questionnaire" || step.from === "interview");
  const startOverLabel = fromQuestions ? t("questionnaire.startOver") : t("cvReview.startOver");
  // From a CV (#1003), its interview stays in the thread at the review too, after the line its reading card folded into.
  const fromCvInterview = cvRead !== null && step.kind !== "choose" && step.kind !== "reading";
  const answering = step.kind === "questionnaire" || step.kind === "interview" || fromQuestions || fromCvInterview;
  const optional = question?.optional || turnOptional;
  const described = [optional ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

  const answeringNow = question !== null || turn !== null;

  // The criteria the offered Job Search is counted with: what was answered or validated so far, in « Affinée avec »
  // (#1001); the interview's proposal waiting for its « Oui, … » counted too, said « (supposé) » until it is validated (#1002).
  const answersDraft = fellBack ? scriptedDraft(questionnaire) : interview.draft;
  const proposed = turn?.proposal && !interview.declining && isRefining(turn.proposal.field) ? turn.proposal.field : null;
  const searchedDraft = turn && proposed ? replied(interview.draft, turn, { kind: "accepted" }) : answersDraft;
  // The offered Job Search, live in AI Activity's « En ce moment », counted « ici » (#1001).
  useFollowedSearch({ jobSearchId: followed?.id ?? null, profileId: followed?.profileId ?? null, href: routes.newProfile, assumed: proposed ? [proposed] : [], ...searchedWith(searchedDraft) });

  /** The Job Search the onboarding offers (#1000), told after the answer that started it (the `after`-th): one line (#1001). */
  const offeredSearchAfter = (answers: number): ReactNode[] =>
    offeredSearch?.after === answers
      ? [
          <CoachLine key="offered-search">
            <p>{offeredSearch.restarted ? t("newProfile.offeredSearchRestarted") : t("newProfile.offeredSearchStarted")}</p>
          </CoachLine>,
        ]
      : [];
  const boxLabel = answeringNow ? t("questionnaire.answerLabel") : t("coachPanel.messageLabel");

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
                  <CvUpload onDraft={read} onReading={setCvReading} />
                </Card>
              </li>
            ) : null}
            {/* « Profil en construction » (#1003): its step under way while the CV is read, then the fields it read. */}
            {step.kind === "choose" && cvReading ? <CvReadingCard draft={null} /> : null}
            {step.kind === "reading" ? <CvReadingCard draft={step.draft} onRead={() => startFromCv(step.draft)} /> : null}
            {fromCvInterview && cvRead ? (
              <>
                <CvReadLine draft={cvRead} />
                <CoachLine>
                  <p>{t("newProfile.fromCv.questionsStart")}</p>
                </CoachLine>
              </>
            ) : null}
            {answering ? (
              <>
                {fromCvInterview ? null : (
                  <>
                    <li className="chat-message chat-candidate">
                      <span className="visually-hidden">{t("questionnaire.you")}</span>
                      <p>{opener || t("newProfile.startQuestionnaire")}</p>
                    </li>
                    <CoachLine>
                      <p>{t("newProfile.questionsStart")}</p>
                    </CoachLine>
                  </>
                )}
                {interview.exchange.flatMap((said, index) => [
                  <CoachLine key={`turn-${index}`}>
                    <TurnWords turn={said} />
                  </CoachLine>,
                  <li key={`reply-${index}`} className="chat-message chat-candidate">
                    <span className="visually-hidden">{t("questionnaire.you")}</span>
                    <p>{replyText(said)}</p>
                  </li>,
                  ...offeredSearchAfter(index + 1),
                ])}
                {fellBack ? (
                  <CoachLine>
                    <p>{t("newProfile.interview.fallback")}</p>
                  </CoachLine>
                ) : null}
                {turns.flatMap((turn, index) => [
                  <CoachLine key={`question-${index}`}>
                    <p>{questionText(turn.question)}</p>
                  </CoachLine>,
                  <li key={`answer-${index}`} className="chat-message chat-candidate">
                    <span className="visually-hidden">{t("questionnaire.you")}</span>
                    <p>{answerText(turn)}</p>
                  </li>,
                  ...offeredSearchAfter(interview.exchange.length + index + 1),
                ])}
              </>
            ) : null}
            {refused ? (
              <li className="chat-message chat-card">
                {refused.prompt ? (
                  <UpgradePrompt prompt={refused.prompt} />
                ) : (
                  <Note tone="warn" role="alert">
                    {t("profiles.quotaReached")}
                  </Note>
                )}
              </li>
            ) : null}
            {step.kind === "interview" && asking.running ? (
              <CoachLine>
                <StreamedActionStatus action={asking} stopLabel={t("aiActivity.live.stop.onboarding_interview")} />
              </CoachLine>
            ) : null}
            {turn ? (
              <CoachLine>
                <TurnWords turn={turn} />
              </CoachLine>
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
                onEdits={setEdits}
                onSaved={confirmed}
              />
            ) : null}
            {/* Saved, the first offers are Activity's (#1006): the end of the offered search's entry, which this line opens. */}
            {step.kind === "review" && step.saved && followed ? <FirstOffersLine /> : null}
            {asides.map((aside, index) => [
              <li key={`aside-${index}`} className="chat-message chat-candidate">
                <span className="visually-hidden">{t("questionnaire.you")}</span>
                <p>{aside.text}</p>
              </li>,
              <CoachLine key={`aside-reply-${index}`}>
                <p>{aside.saved ? t("newProfile.savedOnly") : t("newProfile.reviewOnly")}</p>
              </CoachLine>,
            ])}
          </ol>
        </div>
        <div className="page-conversation-foot">
          {step.kind === "choose" ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => startQuestions()}>
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
          {turn ? (
            <TurnSuggestions
              turn={turn}
              declining={interview.declining}
              firstRef={firstChoice}
              choiceLabel={choiceLabel}
              onReply={replyToTurn}
              onDecline={() => {
                setInterview((now) => ({ ...now, declining: true }));
                box.current?.focus();
              }}
            />
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
            {optional ? (
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
                  required={(question !== null && question.kind !== "yesNo" && !question.optional) || (turn !== null && !turnOptional)}
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
        <InWorkPane key={reviewOpening} kind={REVIEW} title={t("cvReview.title")} href={REVIEW_HREF} back={routes.newProfile} stay>
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

/** The review's form filled from the interview's draft: its Master CV and every Search Criterion it holds (contracts, Sectors…). */
function reviewEditsOf(draft: InterviewDraft): ReviewEdits {
  return { masterCv: draft.masterCv, criteria: criteriaFieldsOf(draft.searchCriteria) };
}

/** A turn of the coach in words: why the last answer was too vague, its question, and what it proposes and why. */
function TurnWords({ turn }: { turn: Pick<InterviewTurn, "challenge"> & { ask: { question: string }; proposal?: { shown: string; because?: string } } }) {
  const { t } = useTranslation();
  return (
    <>
      {turn.challenge ? <p>{turn.challenge}</p> : null}
      <p>{turn.ask.question}</p>
      {turn.proposal ? <p>{t("newProfile.interview.proposal", { value: turn.proposal.shown, because: turn.proposal.because ?? "" }).trim()}</p> : null}
    </>
  );
}

/**
 * The turn's suggestions above the box: « Oui, … » and « Non, plutôt… » for a proposal, then a choice's options, then
 * « Passer cette question » when it may be skipped. « Non, plutôt… » hands over to the box, its answer typed.
 */
function TurnSuggestions(props: {
  turn: InterviewTurn;
  declining: boolean;
  firstRef: RefObject<HTMLButtonElement | null>;
  choiceLabel: (field: InterviewField, choice: string) => string;
  onReply: (reply: InterviewReply) => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const { turn, declining, firstRef, choiceLabel, onReply, onDecline } = props;
  const proposed = turn.proposal && !declining;
  const choices = turn.ask.kind === "choice" ? (turn.ask.choices ?? []) : [];
  if (!proposed && choices.length === 0 && !skippable(turn)) return null;
  return (
    <Suggestions label={t("conversationFirst.suggestions")}>
      {proposed ? (
        <>
          <button ref={firstRef} className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => onReply({ kind: "accepted" })}>
            {t("newProfile.interview.yes", { value: turn.proposal!.shown })}
          </button>
          <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={onDecline}>
            {t("newProfile.interview.no")}
          </button>
        </>
      ) : null}
      {choices.map((choice, index) => (
        <button
          key={choice}
          ref={!proposed && index === 0 ? firstRef : undefined}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          type="button"
          onClick={() => onReply({ kind: "answer", text: choiceLabel(turn.ask.field, choice), choice })}
        >
          {choiceLabel(turn.ask.field, choice)}
        </button>
      ))}
      {skippable(turn) ? (
        <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={() => onReply({ kind: "skipped" })}>
          {t("questionnaire.skip")}
        </button>
      ) : null}
    </Suggestions>
  );
}

/**
 * After « Cela semble correct » (#1006, ADR-0106): the first offers are not a card of the thread but the end of the offered
 * Job Search's entry in Activity (#1001). One line of the coach says so, and « Dans l'activité » opens Activity on it, as
 * under a reply of every conversation (#808); « Continuer vers mon profil » stays above it.
 */
function FirstOffersLine() {
  const { t } = useTranslation();
  const show = useShowInActivity();
  return (
    <CoachLine>
      <p>{t("newProfile.firstOffers")}</p>
      {show ? <InActivity onShow={() => show({ followed: true })} /> : null}
    </CoachLine>
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

/**
 * « Comment marche cette page ? » under the Introduction: its Help Article, in the Work Pane. Not the help's greeting of
 * the other conversations, which promises an answer from the help to a question: this page's box answers none (#997).
 */
function OnboardingHelp({ onOpen }: { onOpen?: () => void }) {
  const { t, i18n } = useTranslation();
  const pathname = usePathname();
  const pane = useWorkPane();
  const here = onThisPage(pathname, helpLocale(i18n.language), "candidate", useHelpSettings());
  if (!here || !pane) return null;
  return (
    <p>
      <button
        type="button"
        className="link-action"
        onClick={() => {
          onOpen?.();
          pane.open({ kind: HELP, article: here.article });
        }}
      >
        {t("conversationFirst.howThisPageWorks")}
      </button>
    </p>
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

/** Suggestions above the box, as on every page that is a conversation. */
function Suggestions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="page-conversation-suggestions" role="group" aria-label={label}>
      <div className="quick-actions">{children}</div>
    </div>
  );
}

/** Whether the turn's question may be skipped: as the AI says, but never the target role or a place (REQUIRED_FIELDS). */
function skippable(turn: Pick<InterviewTurn, "ask">): boolean {
  return turn.ask.optional && !REQUIRED_FIELDS.includes(turn.ask.field);
}

const REFINING: readonly string[] = ["targetRole", "locations", "contractTypes", "remoteWorkOptions", "minSalary"] satisfies RefiningCriterion[];

/** Whether the interview's field is one of the criteria the offered search names in « Affinée avec » (#1001). */
function isRefining(field: InterviewField): field is InterviewField & RefiningCriterion {
  return REFINING.includes(field);
}

/** The Search Criteria the Profile is born with, as one key: a change of any is saved on it (#999, #1002). */
function criteriaKey(criteria: Partial<SearchCriteria>): string {
  return JSON.stringify(criteria);
}

/** The target role and locations, as one key: what the offered Job Search searches for (#1000). */
function targetKey(criteria: Pick<SearchCriteria, "targetRole" | "locations">): string {
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
