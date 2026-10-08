import { describe, expect, it } from "vitest";
import { answer, currentQuestion, draftFromQuestionnaire, startQuestionnaire, type Questionnaire } from "./index";

/** Answers the questions in order, failing the test if one is refused. */
function answerAll(values: string[], questionnaire = startQuestionnaire()): Questionnaire {
  return values.reduce((current, value) => {
    const result = answer(current, value);
    if (!result.ok) throw new Error(`"${value}" refused for ${currentQuestion(current)?.id}: ${result.error}`);
    return result.questionnaire;
  }, questionnaire);
}

const MARIE = [
  "Marie Dupont", // fullName
  "Directrice financière", // targetRole
  "Lyon", // location
  "marie.dupont@example.fr", // email
  "06 12 34 56 78", // phone
  "Directrice financière", // jobTitle 1
  "Groupe Seb", // employer 1
  "Lyon", // jobLocation 1
  "2015 – 2024", // period 1
  "Pilotage financier d'un groupe de 2 000 personnes.", // jobDescription 1
  "yes", // moreExperience
  "Responsable du contrôle de gestion", // jobTitle 2
  "Renault", // employer 2
  "Paris", // jobLocation 2
  "2005 – 2015", // period 2
  "Mise en place du reporting mensuel.", // jobDescription 2
  "no", // moreExperience
  "Master Finance", // degree 1
  "ESSEC", // institution 1
  "1998", // year 1
  "no", // moreEducation
  "Consolidation, IFRS\nSAP", // skills
  "Anglais : courant, Allemand : notions", // languages
  "Directrice financière, 25 ans d'expérience dans l'industrie.", // summary
];

describe("the Onboarding Questionnaire", () => {
  it("asks for the Candidate's name first", () => {
    expect(currentQuestion(startQuestionnaire())).toEqual({ id: "fullName", kind: "text", optional: false });
  });

  it("builds the same Master CV and Search Criteria an uploaded CV gives", () => {
    const finished = answerAll(MARIE);

    expect(currentQuestion(finished)).toBeNull();
    expect(draftFromQuestionnaire(finished)).toEqual({
      masterCv: {
        fullName: "Marie Dupont",
        headline: "Directrice financière",
        email: "marie.dupont@example.fr",
        phone: "06 12 34 56 78",
        location: "Lyon",
        summary: "Directrice financière, 25 ans d'expérience dans l'industrie.",
        experience: [
          {
            title: "Directrice financière",
            employer: "Groupe Seb",
            location: "Lyon",
            period: "2015 – 2024",
            description: "Pilotage financier d'un groupe de 2 000 personnes.",
          },
          { title: "Responsable du contrôle de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "Mise en place du reporting mensuel." },
        ],
        education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
        skills: ["Consolidation", "IFRS", "SAP"],
        languages: [
          { name: "Anglais", level: "courant" },
          { name: "Allemand", level: "notions" },
        ],
      },
      searchCriteria: { targetRole: "Directrice financière", location: "Lyon" },
    });
  });

  it("numbers repeated questions so the AI Coach can say which job or degree it is asking about", () => {
    const secondJob = answerAll(MARIE.slice(0, 11));
    expect(currentQuestion(secondJob)).toEqual({ id: "jobTitle", kind: "text", optional: true, number: 2 });
  });

  it("refuses to go on without a name, a target role and a location", () => {
    expect(answer(startQuestionnaire(), "   ")).toEqual({ ok: false, error: "required" });
    const atLocation = answerAll(["Marie Dupont", "DAF"]);
    expect(answer(atLocation, "")).toEqual({ ok: false, error: "required" });
  });

  it("only takes yes or no to “another job?”", () => {
    const atMore = answerAll(MARIE.slice(0, 10));
    expect(currentQuestion(atMore)).toMatchObject({ id: "moreExperience", kind: "yesNo" });
    expect(answer(atMore, "peut-être")).toEqual({ ok: false, error: "yes_or_no" });
  });

  it("lets the Candidate skip optional questions, and skips a whole job or degree when its title is skipped", () => {
    const finished = answerAll(["Jean Martin", "Chef de projet SI", "Nantes", "", "", "", "", "", "", ""]);

    expect(currentQuestion(finished)).toBeNull();
    expect(draftFromQuestionnaire(finished)).toEqual({
      masterCv: {
        fullName: "Jean Martin",
        headline: "Chef de projet SI",
        email: "",
        phone: "",
        location: "Nantes",
        summary: "",
        experience: [],
        education: [],
        skills: [],
        languages: [],
      },
      searchCriteria: { targetRole: "Chef de projet SI", location: "Nantes" },
    });
  });

  it("reads a language without a level, and trims every answer", () => {
    const finished = answerAll(["  Jean Martin ", "DSI", "Nantes", "", "", "", "", " Voile ;  ", "Anglais\nEspagnol - courant", ""]);
    expect(draftFromQuestionnaire(finished).masterCv).toMatchObject({
      fullName: "Jean Martin",
      skills: ["Voile"],
      languages: [
        { name: "Anglais", level: "" },
        { name: "Espagnol", level: "courant" },
      ],
    });
  });

  it("stops asking for more jobs after ten", () => {
    const job = ["Poste", "Employeur", "", "", ""];
    let questionnaire = answerAll(["Jean Martin", "DSI", "Nantes", "", ""]);
    for (let i = 0; i < 10; i++) questionnaire = answerAll(i < 9 ? [...job, "yes"] : job, questionnaire);
    expect(currentQuestion(questionnaire)).toMatchObject({ id: "degree", number: 1 });
    expect(draftFromQuestionnaire(questionnaire).masterCv.experience).toHaveLength(10);
  });
});
