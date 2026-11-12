import { AiProviderError, createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { NO_INDUSTRY_REFERENCE, type IndustryReference } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import {
  answerCounts,
  checkedTurn,
  choicesNamed,
  foldedProvenance,
  interviewDraft,
  interviewInputSchema,
  nextInterviewTurn,
  replied,
  salaryNamed,
  type ExchangeTurn,
  type InterviewDraft,
  type InterviewTurn,
} from "./index";
import { startQuestionnaire, currentQuestion } from "@/questionnaire";
import { questionnaireDraft } from "./turn";

const BLANK_MASTER_CV = { fullName: "", headline: "", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: [], languages: [] };
const BLANK = interviewDraft({ masterCv: BLANK_MASTER_CV, searchCriteria: { targetRole: "", locations: [] } });
const BORN: InterviewDraft = { ...BLANK, searchCriteria: { ...BLANK.searchCriteria, targetRole: "Directrice financière", locations: ["Lyon (69)"] } };
const places = { suggest: async (name: string) => (name.toLowerCase().startsWith("lyon") ? [{ name: "Lyon (69)", kind: "commune" as const }] : []) };
const industries: IndustryReference = {
  sectors: [{ code: "C", label: { fr: "Industrie manufacturière", en: "Manufacturing" } }],
  subsectors: [{ code: "29", parent: "C", label: { fr: "Industrie automobile" } }],
  domains: [{ code: "M12", parent: "M", label: { fr: "Comptabilité et gestion" } }],
};
const deps = { places, industries, language: "fr" as const };

/** An AI turn as the model writes it, before the code checks it. */
const aiTurn = (turn: Record<string, unknown>) => ({ ask: { field: "targetRole", question: "Quel poste ?", kind: "text" as const }, proposal: null, challenge: null, done: false, ...turn }) as never;

describe("the onboarding interview's draft (#1002, ADR-0006): only what the Candidate answers or validates", () => {
  const proposing: InterviewTurn = {
    ask: { field: "contractTypes", question: "Quel contrat ?", kind: "choice", choices: ["cdi", "cdd", "freelance", "interim"], optional: true },
    proposal: { field: "contractTypes", value: ["cdi"], because: "Un poste de direction.", shown: "CDI" },
    done: false,
  };

  it("takes a proposal the Candidate validated (« Oui, … »)", () => {
    expect(replied(BORN, proposing, { kind: "accepted" }).searchCriteria.contractTypes).toEqual(["cdi"]);
  });

  it("never takes a proposal refused or ignored: « Non, plutôt… » with an answer, another choice, an answer typed, « Passer »", () => {
    expect(replied(BORN, proposing, { kind: "answer", text: "Freelance", declined: true }).searchCriteria.contractTypes).toEqual(["freelance"]);
    expect(replied(BORN, proposing, { kind: "answer", text: "CDD", choice: "cdd" }).searchCriteria.contractTypes).toEqual(["cdd"]);
    expect(replied(BORN, proposing, { kind: "answer", text: "je ne sais pas encore" })).toEqual(BORN);
    expect(replied(BORN, proposing, { kind: "skipped" })).toEqual(BORN);
    // A proposal about another field than the question: answering the question leaves it out too.
    const sideways: InterviewTurn = { ...proposing, ask: { field: "minSalary", question: "Quel salaire ?", kind: "text", optional: true } };
    const answered = replied(BORN, sideways, { kind: "answer", text: "60 000 €" });
    expect(answered.searchCriteria).toMatchObject({ minSalary: 60_000, contractTypes: [] });
  });

  it("reads each answer as its field takes it: the role also titles the CV, places add up, a salary in thousands, a new job by its title", () => {
    const role = replied(BLANK, { ask: { field: "targetRole", question: "", kind: "text", optional: false } }, { kind: "answer", text: " Directrice financière " });
    expect(role.searchCriteria.targetRole).toBe("Directrice financière");
    expect(role.masterCv.headline).toBe("Directrice financière");
    const placed = replied(role, { ask: { field: "locations", question: "", kind: "text", optional: false } }, { kind: "answer", text: "Lyon et Villeurbanne" });
    expect(placed.searchCriteria.locations).toEqual(["Lyon", "Villeurbanne"]);
    expect(placed.masterCv.location).toBe("Lyon");
    const job = replied(placed, { ask: { field: "experience.title", question: "", kind: "text", optional: true } }, { kind: "answer", text: "DAF" });
    const employer = replied(job, { ask: { field: "experience.employer", question: "", kind: "text", optional: true } }, { kind: "answer", text: "Groupe Seb" });
    expect(employer.masterCv.experience).toEqual([{ title: "DAF", employer: "Groupe Seb", location: "", period: "", description: "" }]);
    // A code is never typed: a Sector named in words waits for the coach's proposal.
    expect(replied(placed, { ask: { field: "sectors", question: "", kind: "text", optional: true } }, { kind: "answer", text: "l'industrie" })).toEqual(placed);
  });

  it("names choices and salaries in an answer typed", () => {
    expect(choicesNamed("contractTypes", "Un CDI, ou du freelance")).toEqual(["cdi", "freelance"]);
    expect(choicesNamed("contractTypes", "à durée indéterminée")).toEqual(["cdi"]);
    expect(choicesNamed("remoteWorkOptions", "Hybride")).toEqual(["hybrid"]);
    expect(choicesNamed("remoteWorkOptions", "peu importe")).toEqual([]);
    expect(salaryNamed("55 000 €")).toBe(55_000);
    expect(salaryNamed("55k")).toBe(55_000);
    expect(salaryNamed("60")).toBe(60_000);
    expect(salaryNamed("bien payé")).toBeNull();
  });

  it("counts the answers and the questions skipped, a validated proposal an answer", () => {
    const turn = (reply: ExchangeTurn["reply"]): ExchangeTurn => ({ ask: { field: "targetRole", question: "?" }, reply });
    expect(answerCounts([turn({ kind: "answer", text: "DAF" }), turn({ kind: "accepted" }), turn({ kind: "skipped" })])).toEqual({ answered: 2, skipped: 1 });
  });

  it("hands what it knows to the scripted questions, which take over at the next question (AI unavailable)", () => {
    const scripted = startQuestionnaire(questionnaireDraft({ ...BORN, masterCv: { ...BORN.masterCv, fullName: "Marie Dupont" } }));
    expect(currentQuestion(scripted)).toEqual({ id: "email", kind: "text", optional: true });
  });

  it("folds the turns' calls into one step per model, their tokens summed", () => {
    const one = (at: string) => ({
      v: 1 as const,
      steps: [{ kind: "ai" as const, activity: "think_write" as const, task: "onboarding_interview", provider: "mistral" as const, model: "mistral-medium-3", ms: 900, at, outcome: "ok" as const, count: 1, tokens: { input: 1000, output: 100 } }],
      sites: [{ kind: "candidate" as const, links: [] }],
      startedAt: at,
      wallMs: 900,
    });
    const folded = foldedProvenance(foldedProvenance(null, one("2026-11-12T10:00:00.000Z")), one("2026-11-12T10:01:00.000Z"))!;
    expect(folded.steps).toEqual([expect.objectContaining({ count: 2, ms: 1800, tokens: { input: 2000, output: 200 } })]);
    expect(folded.wallMs).toBe(1800);
  });
});

describe("the AI's turn as the code lets it through (#1002)", () => {
  it("asks the target role and a place first: the Profile is born with them, and the interview is not done before", async () => {
    const turn = await checkedTurn(aiTurn({ ask: { field: "skills", question: "Vos compétences ?", kind: "multiline" }, done: true }), BLANK, [], deps);
    expect(turn).toMatchObject({ ask: { field: "targetRole", question: "Quel poste recherchez-vous ? Par exemple : « Directeur financier ».", optional: false }, done: false });
    const place = await checkedTurn(aiTurn({ ask: { field: "skills", question: "?", kind: "text" } }), { ...BLANK, searchCriteria: { ...BLANK.searchCriteria, targetRole: "DAF" } }, [], deps);
    expect(place.ask).toMatchObject({ field: "locations", optional: false });
    expect((await checkedTurn(aiTurn({ ask: { field: "skills", question: "Vos compétences ?", kind: "multiline" }, done: true }), BORN, [], deps)).done).toBe(true);
  });

  it("never lets the target role or the place be skipped, even asked again once answered (a vague answer challenged)", async () => {
    const vague = { ...BLANK, searchCriteria: { ...BLANK.searchCriteria, targetRole: "Finance" } };
    const again = await checkedTurn(aiTurn({ ask: { field: "targetRole", question: "Quel intitulé exactement ?", kind: "text" }, challenge: "Trop vague." }), vague, [], deps);
    expect(again.ask).toMatchObject({ field: "targetRole", optional: false });
    const place = await checkedTurn(aiTurn({ ask: { field: "locations", question: "Où ?", kind: "text" } }), BORN, [], deps);
    expect(place.ask).toMatchObject({ field: "locations", optional: false });
  });

  it("gives a choice field its own codes, whatever the AI listed, and makes every question but the first two optional", async () => {
    const turn = await checkedTurn(aiTurn({ ask: { field: "remoteWorkOptions", question: "Télétravail ?", kind: "text", choices: ["souvent"] } }), BORN, [], deps);
    expect(turn.ask).toEqual({ field: "remoteWorkOptions", question: "Télétravail ?", kind: "choice", choices: ["on_site", "hybrid", "full_remote"], optional: true });
    const unknown = await checkedTurn(aiTurn({ ask: { field: "age", question: "Quel âge avez-vous ?", kind: "text" } }), BORN, [], deps);
    expect(unknown.done).toBe(true);
  });

  it("keeps a proposal only with a value its field takes, in words for « Oui, … »", async () => {
    const propose = (field: string, value: unknown, draft = BORN) => checkedTurn(aiTurn({ ask: { field, question: "?", kind: "text" }, proposal: { field, value, because: "Parce que." } }), draft, [], deps);

    expect((await propose("contractTypes", ["cdi"])).proposal).toEqual({ field: "contractTypes", value: ["cdi"], because: "Parce que.", shown: "CDI" });
    expect((await propose("contractTypes", ["permanent"])).proposal).toBeUndefined();
    expect((await propose("domains", ["M12"])).proposal).toMatchObject({ value: ["M12"], shown: "Comptabilité et gestion" });
    expect((await propose("domains", ["M99"])).proposal).toBeUndefined();
    expect((await propose("sectors", ["Z"])).proposal).toBeUndefined();
    expect((await propose("subsectors", ["29"])).proposal).toMatchObject({ value: ["29"], shown: "Industrie automobile" });
    expect((await propose("minSalary", "65 000")).proposal).toMatchObject({ value: 65_000, shown: expect.stringMatching(/^65\s000 €$/) });
    expect((await propose("minSalary", -3)).proposal).toBeUndefined();
    expect((await propose("headline", "Directrice financière senior")).proposal).toMatchObject({ value: "Directrice financière senior" });
    // Never who the Candidate is, nor what is already there.
    expect((await propose("email", "marie@example.fr")).proposal).toBeUndefined();
    expect((await propose("targetRole", "Directrice financière")).proposal).toBeUndefined();
    // Places as Place suggestion names them, only those not there yet.
    expect((await propose("locations", ["lyon"], BLANK)).proposal).toMatchObject({ value: ["Lyon (69)"] });
    expect((await propose("locations", ["Paris"])).proposal).toMatchObject({ value: ["Paris"] });
    expect((await propose("locations", ["Lyon"])).proposal).toBeUndefined();
  });

  it("drops a proposal on another field while the Profile is not born yet", async () => {
    const turn = await checkedTurn(aiTurn({ ask: { field: "targetRole", question: "?", kind: "text" }, proposal: { field: "contractTypes", value: ["cdi"], because: "" } }), BLANK, [], deps);
    expect(turn.proposal).toBeUndefined();
  });
});

describe("the next turn from the AI (#1002): task onboarding_interview, its Provenance, the scripted questions when it fails", () => {
  const input = interviewInputSchema.parse({ language: "fr", draft: BORN, exchange: [{ ask: { field: "fullName", question: "Votre nom ?" }, reply: { kind: "answer", text: "Marie Dupont" } }], opener: "Bonjour" });
  const usage = createMemoryUsageLog();
  const run = (reply: string | Error, extra = {}) => {
    const provider = reply instanceof Error ? createFakeProvider({ id: "mistral", fail: reply }) : createFakeProvider({ id: "mistral", reply });
    const ai = createAiLayer({ providers: [provider], routes: { onboarding_interview: "mistral" }, usage });
    return { provider, next: nextInterviewTurn(input, { ai: () => ai, candidateId: "cand-1", places, industries: async () => NO_INDUSTRY_REFERENCE, ...extra }) };
  };

  it("asks the AI with the draft and the exchange, never the Candidate's name, and gives its turn with its Provenance", async () => {
    const { provider, next } = run('```json\n{"ask":{"field":"contractTypes","question":"Quel contrat ?","kind":"choice"},"proposal":{"field":"contractTypes","value":["cdi"],"because":"Un poste de direction."},"challenge":"","done":false}\n```');
    const result = await next;
    expect(result?.turn).toMatchObject({ ask: { field: "contractTypes", kind: "choice" }, proposal: { value: ["cdi"], shown: "CDI" }, done: false });
    expect(result?.provenance?.steps).toEqual([expect.objectContaining({ kind: "ai", task: "onboarding_interview", provider: "mistral", activity: "think_write" })]);
    const sent = JSON.stringify(provider.calls[0]);
    expect(sent).toContain("Entretien d'accueil");
    expect(sent).toContain("Une seule question à la fois");
    expect(sent).not.toContain("Marie Dupont");
    expect(sent).toContain("(réponse donnée)");
    expect(usage.entries.at(-1)).toMatchObject({ task: "onboarding_interview", candidateId: "cand-1", outcome: "ok" });
  });

  it("is null, recorded with onboarding_interview_fallback, when the reply is no turn or the call fails", async () => {
    expect(await run("Bonjour ! Quel poste recherchez-vous ?").next).toBeNull();
    expect(usage.entries.at(-1)).toMatchObject({ outcome: "warning", reason: "onboarding_interview_fallback" });
    expect(await run(new AiProviderError("mistral", "HTTP 503", 503)).next).toBeNull();
    expect(usage.entries.at(-1)).toMatchObject({ outcome: "failed", warnings: [{ reason: "onboarding_interview_fallback" }] });
  });

  it("is done past its turns without calling the AI", async () => {
    const long = interviewInputSchema.parse({ language: "fr", draft: BORN, exchange: Array.from({ length: 40 }, () => ({ ask: { field: "skills", question: "?" }, reply: { kind: "skipped" } })) });
    const provider = createFakeProvider({ id: "mistral", reply: "{}" });
    const ai = createAiLayer({ providers: [provider], routes: { onboarding_interview: "mistral" }, usage });
    expect((await nextInterviewTurn(long, { ai: () => ai, candidateId: "cand-1", places, industries: async () => NO_INDUSTRY_REFERENCE }))?.turn.done).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses an exchange whose field it does not know", () => {
    expect(interviewInputSchema.safeParse({ language: "fr", draft: BORN, exchange: [{ ask: { field: "age", question: "?" }, reply: { kind: "skipped" } }] }).success).toBe(false);
  });
});
