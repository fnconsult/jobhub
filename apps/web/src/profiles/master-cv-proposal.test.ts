import type { MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { acceptedCvEdits, acceptedMasterCv, approvesTheRest, isDeclared, masterCvReview, names } from "./master-cv-proposal";

const master: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." },
    { title: "Contrôleuse de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "Budget et reporting." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Consolidation"],
  languages: [{ name: "Anglais", level: "courant" }],
};

describe("a Master CV change proposed by the AI Coach, reviewed change by change (#719, ADR-0006)", () => {
  it("rephrases, cuts, reorders and puts forward items the Master CV has, each a change of its own", () => {
    const review = masterCvReview(master, [
      { kind: "rephrase", section: "summary", text: "25 ans de direction financière dans l'industrie." },
      { kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Pilotage financier d'un groupe industriel coté." },
      { kind: "cut", section: "skills", item: "sap" },
      { kind: "highlight", section: "skills", item: "Consolidation" },
    ]);

    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.changes.map((change) => change.id)).toEqual(["summary.rephrased", "experience.rephrased.0", "skills.cut.1", "skills.reordered"]);
    expect(review.changes.every((change) => change.kind !== "added")).toBe(true);

    const all = acceptedMasterCv(master, review.edits, review.changes.map((change) => change.id));
    expect(all.summary).toBe("25 ans de direction financière dans l'industrie.");
    expect(all.experience[0]).toEqual({ ...master.experience[0], description: "Pilotage financier d'un groupe industriel coté." });
    expect(all.skills).toEqual(["Consolidation", "IFRS"]);
    // The Identity block and what is not changed are the Master CV's.
    expect({ ...all, summary: master.summary, experience: master.experience, skills: master.skills }).toEqual(master);
  });

  it("keeps the Master CV's text, place or item for every change not accepted", () => {
    const review = masterCvReview(master, [
      { kind: "rephrase", section: "headline", text: "DAF industrie" },
      { kind: "reorder", section: "experience", order: ["Renault", "Groupe Seb"] },
    ]);
    if (!review.ok) throw new Error("not reviewed");

    expect(acceptedMasterCv(master, review.edits, [])).toEqual(master);
    expect(acceptedMasterCv(master, review.edits, ["experience.reordered"]).experience.map((job) => job.employer)).toEqual(["Renault", "Groupe Seb"]);
    expect(acceptedMasterCv(master, review.edits, ["experience.reordered"]).headline).toBe(master.headline);
  });

  it("never adds a fact: an item the Master CV does not have is refused, and a job's employer and dates stay its own", () => {
    expect(masterCvReview(master, [{ kind: "cut", section: "skills", item: "Python" }])).toEqual({ ok: false, error: "unknown_item", item: "Python" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "experience", item: "Airbus", title: "DAF" }])).toEqual({ ok: false, error: "unknown_item", item: "Airbus" });

    const review = masterCvReview(master, [{ kind: "rephrase", section: "experience", item: "Renault", title: "Contrôleuse de gestion senior" }]);
    if (!review.ok) throw new Error("not reviewed");
    const applied = acceptedMasterCv(master, review.edits, review.changes.map((change) => change.id));
    expect(applied.experience[1]).toEqual({ ...master.experience[1], title: "Contrôleuse de gestion senior" });
  });

  it("never adds a skill under cover of rephrasing one: into several, or into another skill, it is refused", () => {
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "SAP, HubSpot, Power BI" }])).toEqual({ ok: false, error: "added_item", text: "SAP, HubSpot, Power BI" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "ERP • CRM\nHubSpot" }])).toMatchObject({ ok: false, error: "added_item" });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "IFRS", text: "Power BI" }])).toEqual({ ok: false, error: "added_item", text: "Power BI" });

    const review = masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "SAP", text: "SAP ERP" }]);
    expect(review.ok && review.changes.map((change) => [change.id, change.tailored])).toEqual([["skills.rephrased.1", "SAP ERP"]]);
  });

  it("flags a rephrasing that brings words of a Job Offer the Master CV lacks: a Flagged Change, never saved without an explicit accept", () => {
    const review = masterCvReview(master, [{ kind: "rephrase", section: "summary", text: "25 ans dans l'industrie aéronautique, expert Kyriba." }], {
      offers: ["Directeur financier, secteur aéronautique. Maîtrise de Kyriba et des normes IFRS."],
    });
    if (!review.ok) throw new Error("not reviewed");

    const [change] = review.changes;
    expect(change).toMatchObject({ id: "summary.rephrased", fromOffer: ["aéronautique", "Kyriba"] });
    // Not accepted (nothing sent for it): the Master CV's words stay.
    expect(acceptedMasterCv(master, review.edits, []).summary).toBe(master.summary);
    expect(acceptedMasterCv(master, review.edits, ["summary.rephrased"]).summary).toBe("25 ans dans l'industrie aéronautique, expert Kyriba.");
  });

  it("never translates the Master CV piecemeal: a rephrasing in another language is refused, the documents are written in their own language", () => {
    // Its diplomas and languages cannot be reworded: a translation by edits would leave them, and the rest, in French.
    expect(
      masterCvReview(master, [
        { kind: "rephrase", section: "headline", text: "Chief Financial Officer" },
        { kind: "rephrase", section: "summary", text: "25 years in the manufacturing industry." },
        { kind: "rephrase", section: "experience", item: "Groupe Seb", title: "Chief Financial Officer", description: "Financial management of the group." },
      ]),
    ).toEqual({ ok: false, error: "translated", text: "25 years in the manufacturing industry." });
    // A rephrasing in its own language, or one too short to tell, is no translation.
    expect(masterCvReview(master, [{ kind: "rephrase", section: "summary", text: "25 ans dans l'industrie manufacturière." }]).ok).toBe(true);
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "Consolidation", text: "Consolidation IFRS" }]).ok).toBe(true);
  });

  it("reads a figure written within a word or with a sign as the Master CV writes it: no invented figure (#1077)", () => {
    const withFigures = { ...master, experience: [{ ...master.experience[0]!, description: "Réorganisation des flux : +25 % de capacité, 500k€ économisés, SaaS B2B2X." }, master.experience[1]!] };
    const review = masterCvReview(withFigures, [{ kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Flux réorganisés : +25 % de capacité, 500k€ économisés (SaaS B2B2X)." }]);
    expect(review.ok).toBe(true);
    expect(masterCvReview(withFigures, [{ kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Flux réorganisés : +30 % de capacité." }])).toMatchObject({ ok: false, error: "invented_figure" });
  });

  it("proposes nothing when the edits change nothing", () => {
    expect(masterCvReview(master, [{ kind: "rephrase", section: "headline", text: master.headline }])).toEqual({ ok: false, error: "no_change" });
  });
});

describe("a Declared Fact enters a CV (ADR-0113, #1097)", () => {
  const said = ["Ajoute Power BI à mes compétences, je l'utilise depuis 3 ans.", "Mon anglais est C1 maintenant, et j'ai un MBA de l'INSEAD."];

  it("adds a skill the Candidate declared in the conversation, marked « Fait déclaré par vous »", () => {
    const review = masterCvReview(master, [{ kind: "add", section: "skills", text: "Power BI" }], { declared: said });
    if (!review.ok) throw new Error(`not reviewed: ${JSON.stringify(review)}`);
    expect(review.changes).toEqual([{ id: "skills.added.Power BI", section: "skills", kind: "added", item: "Power BI", declared: true }]);
    expect(acceptedMasterCv(master, review.edits, ["skills.added.Power BI"], { declared: said }).skills).toEqual([...master.skills, "Power BI"]);
    expect(acceptedMasterCv(master, review.edits, [], { declared: said }).skills).toEqual(master.skills);
  });

  it("refuses a skill the Candidate never declared: not_declared, with its section", () => {
    expect(masterCvReview(master, [{ kind: "add", section: "skills", text: "Tableau" }], { declared: said })).toEqual({ ok: false, error: "not_declared", text: "Tableau", section: "skills" });
    // What the Job Offer or the AI Coach says is never a Declared Fact: only the Candidate's own messages count.
    expect(masterCvReview(master, [{ kind: "add", section: "skills", text: "Power BI" }])).toEqual({ ok: false, error: "not_declared", text: "Power BI", section: "skills" });
    // A whole word, not a piece of one.
    expect(masterCvReview(master, [{ kind: "add", section: "skills", text: "BI" }], { declared: ["Je fais du BIM"] })).toMatchObject({ ok: false, error: "not_declared" });
  });

  it("rephrases a skill into another only when the Candidate declared it; else added_item", () => {
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "IFRS", text: "Power BI" }], { declared: said })).toMatchObject({ ok: true });
    expect(masterCvReview(master, [{ kind: "rephrase", section: "skills", item: "IFRS", text: "Tableau" }], { declared: said })).toEqual({ ok: false, error: "added_item", text: "Tableau" });
  });

  it("corrects a language level, and adds a language or a diploma, the Candidate declared", () => {
    const review = masterCvReview(
      master,
      [
        { kind: "rephrase", section: "languages", item: "Anglais", level: "C1" },
        { kind: "add", section: "education", text: "MBA", institution: "INSEAD" },
      ],
      { declared: said },
    );
    if (!review.ok) throw new Error(`not reviewed: ${JSON.stringify(review)}`);
    expect(review.changes).toEqual([
      { id: "education.added.MBA · INSEAD", section: "education", kind: "added", item: "MBA · INSEAD", declared: true },
      { id: "languages.rephrased.0", section: "languages", kind: "rephrased", item: "Anglais · courant", master: "Anglais · courant", tailored: "Anglais · C1", declared: true },
    ]);
    const all = acceptedMasterCv(master, review.edits, review.changes.map((change) => change.id), { declared: said });
    expect(all.languages).toEqual([{ name: "Anglais", level: "C1" }]);
    expect(all.education).toEqual([...master.education, { degree: "MBA", institution: "INSEAD", year: "" }]);
    expect(masterCvReview(master, [{ kind: "rephrase", section: "languages", item: "Anglais", level: "bilingue" }], { declared: said })).toEqual({
      ok: false,
      error: "not_declared",
      text: "bilingue",
      section: "languages",
    });
  });

  describe("a value is in the CV only on the item it qualifies, never elsewhere in the CV", () => {
    const cv: MasterCvContent = {
      ...master,
      experience: [{ title: "Contrôleuse de gestion", employer: "Renault", location: "Toulouse", period: "2019 – 2024", description: "Budget et reporting avec l'Université de Toulouse." }],
      languages: [
        { name: "Anglais", level: "C1" },
        { name: "Espagnol", level: "B1" },
      ],
    };

    it("a language level another language has is not said of this one: not_declared", () => {
      expect(masterCvReview(cv, [{ kind: "rephrase", section: "languages", item: "Espagnol", level: "C1" }], { declared: ["Je voudrais retravailler mes langues."] })).toEqual({
        ok: false,
        error: "not_declared",
        text: "C1",
        section: "languages",
      });
    });

    it("a language added with a level the Candidate did not declare for it: not_declared, even when another language has that level", () => {
      expect(masterCvReview(cv, [{ kind: "add", section: "languages", item: "Allemand", level: "C1" }], { declared: ["Je parle allemand."] })).toEqual({
        ok: false,
        error: "not_declared",
        text: "C1",
        section: "languages",
      });
      // Declared for another language than the one added: not for this one.
      expect(masterCvReview(cv, [{ kind: "add", section: "languages", item: "Allemand", level: "C1" }], { declared: ["Je parle allemand.", "Mon espagnol est C1."] })).toMatchObject({
        ok: false,
        error: "not_declared",
      });
      // Said of it: added, marked.
      const review = masterCvReview(cv, [{ kind: "add", section: "languages", item: "Allemand", level: "C1" }], { declared: ["Je parle allemand, niveau C1."] });
      expect(review.ok && review.changes).toEqual([expect.objectContaining({ kind: "added", item: "Allemand · C1", declared: true })]);
    });

    it("a diploma's institution and year written elsewhere in the CV are not said of it: not_declared", () => {
      expect(
        masterCvReview(cv, [{ kind: "add", section: "education", text: "Master audit", institution: "Université de Toulouse", year: "2019" }], { declared: ["J'ai aussi un Master audit."] }),
      ).toEqual({ ok: false, error: "not_declared", text: "Université de Toulouse", section: "education" });
    });

    it("a language or a diploma the reference CV has is added back with what it says of it, not with another value", () => {
      const tailored = { ...cv, languages: [cv.languages[0]!], education: [] };
      expect(masterCvReview(tailored, [{ kind: "add", section: "languages", item: "Espagnol", level: "B1" }], { reference: cv }).ok).toBe(true);
      expect(masterCvReview(tailored, [{ kind: "add", section: "languages", item: "Espagnol", level: "C1" }], { reference: cv })).toMatchObject({ ok: false, error: "not_declared", text: "C1" });
      expect(masterCvReview(tailored, [{ kind: "add", section: "education", text: "Master Finance", institution: "ESSEC", year: "1998" }], { reference: cv }).ok).toBe(true);
      expect(masterCvReview(tailored, [{ kind: "add", section: "education", text: "Master Finance", institution: "ESSEC", year: "2019" }], { reference: cv })).toMatchObject({ ok: false, error: "not_declared", text: "2019" });
    });

    it("a skill is in the CV when its skills, or its reference's, list it: a word of a job is not one", () => {
      expect(masterCvReview(cv, [{ kind: "add", section: "skills", text: "Reporting" }])).toEqual({ ok: false, error: "not_declared", text: "Reporting", section: "skills" });
      expect(masterCvReview(cv, [{ kind: "rephrase", section: "skills", item: "IFRS", text: "Budget" }])).toEqual({ ok: false, error: "added_item", text: "Budget" });
    });
  });

  it("adds back an item of the reference CV without it being declared: it is in the CV (a Tailored CV that cut it)", () => {
    const tailored = { ...master, skills: ["IFRS"] };
    const review = masterCvReview(tailored, [{ kind: "add", section: "skills", text: "SAP" }], { reference: master });
    expect(review.ok && review.changes).toEqual([{ id: "skills.added.SAP", section: "skills", kind: "added", item: "SAP" }]);
  });
});

describe("a Tailored CV in English with a French reference CV, reworked from the Coach Conversation (#1133)", () => {
  const reference: MasterCvContent = { ...master, skills: ["Ingénierie logicielle", "Gestion d'équipe", "Recrutement", "Conseil technique", "Clients grands comptes", "Communication"] };
  const english = ["Software engineering", "Team management", "Recruitment", "Technical consulting", "Key accounts", "Communication"];
  const tailored: MasterCvContent = { ...master, headline: "Chief Financial Officer", skills: english, languages: [{ name: "English", level: "fluent" }] };
  const edits = [
    { kind: "reorder" as const, section: "skills" as const, order: ["Key accounts", "Software engineering"] },
    { kind: "rephrase" as const, section: "headline" as const, text: "Chief Financial Officer, industry" },
  ];

  it("its skills reordered, the reordering accepted or rejected and another change rejected, every skill stays in English", () => {
    const review = masterCvReview(tailored, edits, { reference });
    if (!review.ok) throw new Error("refused");
    const ids = review.changes.map((change) => change.id);
    expect(ids).toEqual(["headline.rephrased", "skills.reordered"]);

    expect(acceptedCvEdits(tailored, edits, ids, { reference })?.content.skills).toEqual(["Key accounts", "Software engineering", "Team management", "Recruitment", "Technical consulting", "Communication"]);
    expect(acceptedCvEdits(tailored, edits, ["headline.rephrased"], { reference })?.content.skills).toEqual(english);
    const headlineRejected = acceptedCvEdits(tailored, edits, ["skills.reordered"], { reference })?.content;
    expect(headlineRejected?.headline).toBe("Chief Financial Officer");
    expect(headlineRejected?.skills.every((skill) => !reference.skills.includes(skill) || skill === "Communication")).toBe(true);
  });
});

describe("a Declared Fact said in the Candidate's own words: a typo, a translation, « the rest » approved (#1133)", () => {
  /** The product owner's exchange, word for word: the Candidate's messages, and the AI Coach's listing they answered. */
  const said = [
    "skills are not in english, please translate them as well",
    "Team management: from acteos, S&A, ebcard and orbility / Recreuitement: acteos, s&A / Enterprise key accounts : acteos, klareo, s&a / for the rest it is all good",
  ];
  const listed =
    "Je n'ai pas pu préparer la traduction : les six compétences de votre CV adapté (Ingénierie logicielle, Gestion d'équipe, Recrutement, Conseil technique, Clients grands comptes, Communication) sont exactement celles de l'offre, et votre CV de référence n'a pas de rubrique compétences. Lesquelles avez-vous réellement ?";
  /** The Tailored CV: English, its skills the offer's, in French; its reference without skills. */
  const reference: MasterCvContent = { ...master, skills: [] };
  const tailored: MasterCvContent = {
    ...master,
    headline: "Head of Professional Services",
    skills: ["Ingénierie logicielle", "Gestion d'équipe", "Recrutement", "Conseil technique", "Clients grands comptes", "Communication"],
  };
  const translation = [
    { kind: "rephrase" as const, section: "skills" as const, item: "Ingénierie logicielle", text: "Software engineering" },
    { kind: "rephrase" as const, section: "skills" as const, item: "Gestion d'équipe", text: "Team management" },
    { kind: "rephrase" as const, section: "skills" as const, item: "Recrutement", text: "Recruitment" },
    { kind: "rephrase" as const, section: "skills" as const, item: "Conseil technique", text: "Technical consulting" },
    { kind: "rephrase" as const, section: "skills" as const, item: "Clients grands comptes", text: "Enterprise key accounts" },
  ];

  it("a value is named a typo apart, in its words' order; a short word or a figure exactly", () => {
    expect(names(said[1]!, "Recruitment")).toBe(true);
    expect(names(said[1]!, "Team management")).toBe(true);
    expect(names("j'utilise SAP", "SQL")).toBe(false);
    expect(names("10 ans de management", "12 ans de management")).toBe(false);
    expect(names("management team", "Team management")).toBe(false);
  });

  it("« the rest » or « the others » said good approves the listing before; a bare « ok » does not", () => {
    expect(approvesTheRest(said[1]!)).toBe(true);
    expect(approvesTheRest("Pour le reste, c'est bon.")).toBe(true);
    expect(approvesTheRest("the others are fine")).toBe(true);
    expect(approvesTheRest("ok")).toBe(false);
    expect(approvesTheRest(said[0]!)).toBe(false);
  });

  it("the skills declared or approved as a whole are translated, each marked « Fait déclaré par vous », reviewed one by one", () => {
    const review = masterCvReview(tailored, translation, { declared: said, approved: [listed], reference });

    if (!review.ok) throw new Error(`refused: ${JSON.stringify(review)}`);
    expect(review.changes.map((change) => [change.id, change.tailored, change.declared])).toEqual([
      ["skills.rephrased.0", "Software engineering", true],
      ["skills.rephrased.1", "Team management", true],
      ["skills.rephrased.2", "Recruitment", true],
      ["skills.rephrased.3", "Technical consulting", true],
      ["skills.rephrased.4", "Enterprise key accounts", true],
    ]);
    const saved = acceptedCvEdits(tailored, review.edits, review.changes.map((change) => change.id), { declared: true, reference });
    expect(saved?.content.skills).toEqual(["Software engineering", "Team management", "Recruitment", "Technical consulting", "Enterprise key accounts", "Communication"]);
  });

  it("strict on where the fact comes from: never approved without the Candidate's « the rest », nor a skill the AI Coach did not list", () => {
    // The AI Coach's listing alone, the Candidate never approving it: not declared.
    expect(masterCvReview(tailored, [translation[0]!], { declared: [said[0]!], approved: [], reference })).toMatchObject({ ok: false, error: "added_item", text: "Software engineering" });
    // Approved, but the listing never named that skill.
    expect(masterCvReview(tailored, [translation[3]!], { declared: [said[0]!], approved: ["Votre CV adapté liste Ingénierie logicielle."], reference })).toMatchObject({
      ok: false,
      error: "added_item",
    });
    // Another skill, which the Candidate never stated: refused, whatever they approved.
    expect(masterCvReview(tailored, [{ kind: "add", section: "skills", text: "Kubernetes" }], { declared: said, approved: [listed], reference })).toMatchObject({ ok: false, error: "not_declared" });
    expect(isDeclared("Kubernetes", said)).toBe(false);
  });
});
