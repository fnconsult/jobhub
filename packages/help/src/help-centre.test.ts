import { describe, expect, it } from "vitest";
import { articleFor, articles, articlesFor, backOfficeHelpArticle, backOfficeHelpTopics, helpCentreArticle, helpCentreTopics, isPublic, relatedArticles, search } from "./index";
import { PUBLIC_HELP_TOPICS, type HelpArticle } from "./types";

// Issue #549 (ADR-0065): the public Help Centre's topics, articles, search and addresses, and the Coach Panel's scope.
// An Administrator's article is never public: a test article of that audience is looked for everywhere (the sitemap's
// side: apps/web/src/public-pages/indexing.test.ts).

const entry = (fields: Partial<HelpArticle> & Pick<HelpArticle, "id" | "title">): HelpArticle => ({
  locale: "fr",
  kind: "faq",
  audience: "candidate",
  topic: "utiliser",
  synonyms: [],
  route: null,
  motion: null,
  microAnimations: [],
  body: "Un texte.",
  ...fields,
});

const ADMIN = entry({ id: "faq-admin-reglages", title: "Changer les réglages de la plateforme", audience: "administrator", topic: "plateforme", synonyms: ["réglages", "plateforme"] });
const FIXTURE: HelpArticle[] = [
  entry({ id: "faq-reglages", title: "Où changer mes réglages ?", synonyms: ["réglages"] }),
  entry({ id: "tutorial-extension", kind: "tutorial", title: "Enregistrer une offre avec l'extension", topic: "extension", synonyms: ["extension", "offre"], body: "1. Ouvrez.\n2. Cliquez." }),
  entry({ id: "faq-where", title: "Où trouver l'aide ?", audience: "visitor", topic: "decouvrir", synonyms: ["aide", "réglages"] }),
  entry({ id: "faq-coach", title: "Préparer une séance", audience: "human-coach", topic: "espace-coach", synonyms: ["séance"] }),
  ADMIN,
];

describe("helpCentreTopics — /aide's four topics", () => {
  it("lists the four public topics in their order, each with its public articles, an Administrator's never", () => {
    const topics = helpCentreTopics("fr", FIXTURE);
    expect(topics.map((topic) => topic.topic)).toEqual(["decouvrir", "extension", "utiliser", "espace-coach"]);
    expect(topics.map((topic) => topic.articles.map((found) => found.id))).toEqual([["faq-where"], ["tutorial-extension"], ["faq-reglages"], ["faq-coach"]]);
    expect(topics.flatMap((topic) => topic.articles)).not.toContain(ADMIN);
  });

  it("keeps an empty topic, with no articles: it says « Bientôt des articles ici », never a 404", () => {
    expect(helpCentreTopics("fr", [FIXTURE[0]!]).map((topic) => topic.articles.length)).toEqual([0, 0, 1, 0]);
  });
});

describe("helpCentreArticle — the article /aide/<topic>/<article> serves", () => {
  it("finds a public article in its own topic only", () => {
    expect(helpCentreArticle("extension", "tutorial-extension", "fr", FIXTURE)?.title).toBe("Enregistrer une offre avec l'extension");
    expect(helpCentreArticle("utiliser", "tutorial-extension", "fr", FIXTURE)).toBeNull();
    expect(helpCentreArticle("inconnue", "tutorial-extension", "fr", FIXTURE)).toBeNull();
  });

  it("never serves an Administrator's article, whatever topic its address names", () => {
    expect(isPublic(ADMIN)).toBe(false);
    for (const topic of [...PUBLIC_HELP_TOPICS, "parametres"]) expect(helpCentreArticle(topic, ADMIN.id, "fr", FIXTURE)).toBeNull();
  });
});

describe("search — its scopes", () => {
  it("public: every article but an Administrator's", () => {
    const found = search("réglages plateforme", "fr", { from: FIXTURE, limit: 10 }).map((article) => article.id);
    expect(found).toContain("faq-reglages");
    expect(found).not.toContain(ADMIN.id);
  });

  it("coachPanel: the Candidate's articles and the « extension » topic's, never a Visitor's, a Human Coach's or an Administrator's", () => {
    const ids = (query: string) => search(query, "fr", { from: FIXTURE, scope: "coachPanel", limit: 10 }).map((article) => article.id);
    expect(ids("réglages")).toEqual(["faq-reglages"]);
    expect(ids("extension offre")).toEqual(["tutorial-extension"]);
    expect(ids("séance")).toEqual([]);
  });

  it("finds, in the Coach Panel, this build's tutorial of the « extension » topic, in French and English", () => {
    expect(search("enregistrer une offre avec l'extension", "fr", { scope: "coachPanel" }).map((article) => article.id)).toContain("tutorial-extension-save-job-offer");
    expect(search("save a job offer with the extension", "en", { scope: "coachPanel" }).map((article) => article.id)).toContain("tutorial-extension-save-job-offer");
  });
});

describe("relatedArticles — under an article's page", () => {
  it("gives public articles only, never the article itself, 3 at most", () => {
    const related = relatedArticles(FIXTURE[0]!, { from: FIXTURE });
    expect(related.map((article) => article.id)).toContain("faq-where");
    expect(related).not.toContain(FIXTURE[0]);
    expect(related).not.toContain(ADMIN);
    expect(relatedArticles(articles("fr")[0]!).length).toBeLessThanOrEqual(3);
  });
});

/** #552's articles of « Découvrir Jobbbox ». */
const DECOUVRIR_PAGES = ["page-what-is-jobbbox", "page-install-extension", "page-recipient-list"];
const DECOUVRIR_FAQ = ["faq-sign-in-link", "faq-plans-and-quotas", "faq-text-size-site", "faq-job-digest-unsubscribe", "faq-contact-us", "faq-data-and-ai"];
/** #553's articles of « L'extension », each with its audience: the Guest's, and the signed-in Candidate's. */
const EXTENSION_ARTICLES = {
  "page-side-panel": ["page", "guest"],
  "faq-extension-badge-sites": ["faq", "guest"],
  "faq-guest-session": ["faq", "guest"],
  "faq-rescore-why-match-score": ["faq", "candidate"],
  "tutorial-extension-analyse-job-offer": ["tutorial", "guest"],
  "tutorial-extension-create-account": ["tutorial", "guest"],
  "tutorial-extension-save-job-offer": ["tutorial", "candidate"],
} as const;
/** « Espace coach v2 » on (#867): public intake and anonymous-report Help remains available before Coach or Candidate membership. */
const COACH_PUBLIC_ARTICLES = ["page-content-report", "glossary-coach-enrolment", "page-confirm-coach-enrolment", "page-own-coach-enrolments", "page-coach-enrolment", "glossary-association"];
/** #554's articles of « Espace coach », all a Human Coach's: no help in context for them (ADR-0065), the topic is theirs. */
const COACH_SPACE_ARTICLES = {
  "page-coach-space": "page",
  "faq-coach-access": "faq",
  "faq-retired-human-coach": "faq",
  // #665: why a Human Coach is asked for Two-step verification.
  "faq-coach-two-step-verification": "faq",
  // #688: the same, in the app.
  "faq-coach-app-two-step-verification": "faq",
  // #699: the app's notifications for a coach.
  "faq-coach-app-notifications": "faq",
  "tutorial-coach-session-date": "tutorial",
  "tutorial-coach-review": "tutorial",
} as const;
/** « Espace coach v2 » on (#867): the current Coach and Association workspace articles, all a Human Coach's. */
const COACH_SPACE_V2_ARTICLES = {
  "page-coach-space": "page",
  "page-association-coachs": "page",
  "page-association-invitation": "page",
  "page-association-membres": "page",
  "page-association-offres": "page",
  "page-association-revenus": "page",
  "page-association-space": "page",
  "page-coach-availability": "page",
  "page-coach-contract-version": "page",
  "page-coach-contract": "page",
  "page-coach-earnings": "page",
  "page-coach-public-profile": "page",
  "page-coach-reminders": "page",
  "page-coach-session": "page",
  "faq-coach-access": "faq",
  "faq-retired-human-coach": "faq",
  "faq-coach-two-step-verification": "faq",
  "faq-coach-app-two-step-verification": "faq",
  "faq-coach-app-notifications": "faq",
  "faq-coach-cancel-session": "faq",
  "faq-coach-contract": "faq",
  "faq-coach-reminders": "faq",
  "faq-coach-tax": "faq",
  "tutorial-association-add-coach": "tutorial",
  "tutorial-coach-availability": "tutorial",
  "tutorial-coach-get-paid": "tutorial",
  "tutorial-coach-meeting-contact": "tutorial",
  "tutorial-coach-present-slides": "tutorial",
  "tutorial-coach-review": "tutorial",
  "tutorial-coach-session-date": "tutorial",
  "tutorial-coach-session-report": "tutorial",
  "tutorial-coach-shared-reading": "tutorial",
  "tutorial-coach-tax": "tutorial",
  "tutorial-coaching-reminders": "tutorial",
  "tutorial-edit-coach-page": "tutorial",
  "glossary-association-member": "glossary",
  "glossary-coach-page": "glossary",
} as const;

describe("this build's Help Articles (#549)", () => {
  it.each([
    ["off", {}, [], COACH_SPACE_ARTICLES],
    ["on", { coachSpaceV2: true }, COACH_PUBLIC_ARTICLES, COACH_SPACE_V2_ARTICLES],
  ] as const)(
    "each declares its audience and topic, the same in French and English; the former Candidate articles stay `candidate`, a Back Office page's or glossary entry is an Administrator's (« Espace coach v2 » %s)",
    (_, settings, coachPublic: readonly string[], coachSpace) => {
      const english = new Map(articles("en", settings).map((found) => [found.id, found]));
      for (const found of articles("fr", settings)) {
        expect([found.id, english.get(found.id)?.audience, english.get(found.id)?.topic]).toEqual([found.id, found.audience, found.topic]);
        if (coachPublic.includes(found.id)) expect(found.audience).toBe("visitor");
        const backOffice = found.route?.startsWith("/admin") === true || found.id.startsWith("glossary-admin-");
        if (/^(page|glossary)-/.test(found.id) && !DECOUVRIR_PAGES.includes(found.id) && !coachPublic.includes(found.id) && !(found.id in EXTENSION_ARTICLES) && !(found.id in coachSpace))
          expect([found.id, found.audience]).toEqual([found.id, backOffice ? "administrator" : "candidate"]);
      }
    },
  );

  it("has the « Découvrir Jobbbox » articles for a Visitor (#552, #338): 3 pages, 6 questions and 1 tutorial, in French and English", () => {
    const ids = { page: DECOUVRIR_PAGES, faq: DECOUVRIR_FAQ, tutorial: ["tutorial-getting-started"] };
    for (const locale of ["fr", "en"] as const)
      for (const [kind, expected] of Object.entries(ids))
        for (const id of expected) expect([id, helpCentreArticle("decouvrir", id, locale)?.kind, helpCentreArticle("decouvrir", id, locale)?.audience]).toEqual([id, kind, "visitor"]);
  });

  it("has the « L'extension » articles (#553): 1 page, 3 questions and 3 tutorials, in French and English, under the topic", () => {
    for (const locale of ["fr", "en"] as const) {
      const topic = helpCentreTopics(locale).find((entry) => entry.topic === "extension");
      expect(topic?.articles.map((found) => found.id)).toEqual(expect.arrayContaining(Object.keys(EXTENSION_ARTICLES)));
      for (const [id, [kind, audience]] of Object.entries(EXTENSION_ARTICLES))
        expect([id, helpCentreArticle("extension", id, locale)?.kind, helpCentreArticle("extension", id, locale)?.audience]).toEqual([id, kind, audience]);
    }
  });

  it.each([
    ["fr", "effacer mes données", "faq-guest-session"],
    ["fr", "le bouton n'apparaît pas", "faq-extension-badge-sites"],
    ["fr", "recalculer", "faq-rescore-why-match-score"],
    ["fr", "panneau latéral", "page-side-panel"],
    ["fr", "créer un compte depuis l'extension", "tutorial-extension-create-account"],
    ["fr", "analyser une offre", "tutorial-extension-analyse-job-offer"],
    ["en", "guest session", "faq-guest-session"],
    ["en", "side panel", "page-side-panel"],
    ["en", "rescore", "faq-rescore-why-match-score"],
  ] as const)("finds, from a Candidate's Coach Panel, in %s, « %s »: %s (#553)", (locale, query, id) => {
    expect(search(query, locale, { scope: "coachPanel" }).map((article) => article.id)).toContain(id);
  });

  it("has the « Espace coach » articles (#554, #665): 1 page, 3 questions and 2 tutorials, a Human Coach's, in French and English, under the topic", () => {
    for (const locale of ["fr", "en"] as const) {
      const topic = helpCentreTopics(locale).find((entry) => entry.topic === "espace-coach");
      expect(topic?.articles.map((found) => found.id).sort()).toEqual(Object.keys(COACH_SPACE_ARTICLES).sort());
      for (const [id, kind] of Object.entries(COACH_SPACE_ARTICLES))
        expect([id, helpCentreArticle("espace-coach", id, locale)?.kind, helpCentreArticle("espace-coach", id, locale)?.audience]).toEqual([id, kind, "human-coach"]);
    }
    expect(articleFor("/espace-coach", "fr")?.id).toBe("page-coach-space");
  });

  it("has the current Coach and Association workspace Help, in French and English, under the Human Coach topic (« Espace coach v2 » on)", () => {
    for (const locale of ["fr", "en"] as const) {
      const from = articlesFor(locale, { coachSpaceV2: true });
      const topic = helpCentreTopics(locale, from).find((entry) => entry.topic === "espace-coach");
      expect(topic?.articles.map((found) => found.id).sort()).toEqual(Object.keys(COACH_SPACE_V2_ARTICLES).sort());
      for (const [id, kind] of Object.entries(COACH_SPACE_V2_ARTICLES))
        expect([id, helpCentreArticle("espace-coach", id, locale, from)?.kind, helpCentreArticle("espace-coach", id, locale, from)?.audience]).toEqual([id, kind, "human-coach"]);
    }
    expect(articleFor("/espace-coach", "fr", { from: articlesFor("fr", { coachSpaceV2: true }) })?.id).toBe("page-coach-space");
  });

  it.each([
    ["fr", "retirer l'accès coach", "faq-coach-access"],
    ["fr", "le candidat a retiré l'accès", "faq-coach-access"],
    ["fr", "coach retiré", "faq-retired-human-coach"],
    ["fr", "lien de la visio", "tutorial-coach-session-date"],
    ["fr", "saisir la date", "tutorial-coach-session-date"],
    ["fr", "commenter la lettre de motivation", "tutorial-coach-review"],
    ["fr", "espace coach", "page-coach-space"],
    ["en", "withdraw coach access", "faq-coach-access"],
    ["en", "retired coach", "faq-retired-human-coach"],
    ["en", "video link", "tutorial-coach-session-date"],
    ["en", "coach review", "tutorial-coach-review"],
  ] as const)("finds in the Help Centre, in %s, « %s »: %s (#554), never from a Candidate's Coach Panel, « Espace coach v2 » off and on", (locale, query, id) => {
    for (const from of [articlesFor(locale), articlesFor(locale, { coachSpaceV2: true })]) {
      expect(search(query, locale, { from }).map((article) => article.id)).toContain(id);
      expect(search(query, locale, { scope: "coachPanel", from }).map((article) => article.id)).not.toContain(id);
    }
  });

  it("has tutorials in French and English, each of two numbered steps or more", () => {
    for (const locale of ["fr", "en"] as const) {
      const tutorials = articles(locale).filter((found) => found.kind === "tutorial");
      expect(tutorials.map((found) => found.id)).toContain("tutorial-extension-save-job-offer");
      for (const found of tutorials) expect(found.body).toMatch(/^1\. .+\n2\. /m);
    }
  });

  it("answers « Où trouver l'aide de Jobbbox ? » for a Visitor, in the « decouvrir » topic", () => {
    const found = helpCentreArticle("decouvrir", "faq-where-to-find-help", "fr");
    expect([found?.title, found?.audience]).toEqual(["Où trouver l'aide de Jobbbox ?", "visitor"]);
  });
});

describe("the Back Office's help (#551): the Administrators' articles, in the Back Office only", () => {
  const PROVIDERS = entry({ id: "page-admin-outils", kind: "page", title: "Outils", audience: "administrator", topic: "fournisseurs-et-tools", route: "/admin/outils", synonyms: ["outil"] });
  const AI = entry({ id: "faq-admin-ia", title: "Ce que fait l'IA", audience: "administrator", topic: "ia-et-conformite", synonyms: ["réglages"] });
  const BACK_OFFICE = [...FIXTURE, AI, PROVIDERS];

  it("lists its topics « Fournisseurs et Tools » first and « IA et conformité » last, each with its Administrator articles only", () => {
    const topics = backOfficeHelpTopics("fr", BACK_OFFICE);
    expect(topics[0]).toEqual({ topic: "fournisseurs-et-tools", articles: [PROVIDERS] });
    expect(topics.at(-1)).toEqual({ topic: "ia-et-conformite", articles: [AI] });
    expect(topics.flatMap((topic) => topic.articles).every((found) => found.audience === "administrator")).toBe(true);
    expect(topics.find((topic) => topic.topic === "plateforme")?.articles).toEqual([ADMIN]);
  });

  it("serves an Administrator's article at /admin/aide/<topic>/<id>, never a public one", () => {
    expect(backOfficeHelpArticle("plateforme", "faq-admin-reglages", "fr", BACK_OFFICE)).toBe(ADMIN);
    expect(backOfficeHelpArticle("utiliser", "faq-reglages", "fr", BACK_OFFICE)).toBeNull();
    expect(backOfficeHelpArticle("ia-et-conformite", "faq-admin-reglages", "fr", BACK_OFFICE)).toBeNull();
  });

  it("searches the Administrators' articles only in the `backOffice` scope, and never them elsewhere", () => {
    expect(search("réglages", "fr", { scope: "backOffice", from: BACK_OFFICE })).toEqual([ADMIN, AI]);
    expect(search("réglages", "fr", { from: BACK_OFFICE })).not.toContain(ADMIN);
    expect(search("réglages", "fr", { scope: "coachPanel", from: BACK_OFFICE })).not.toContain(AI);
  });

  it("finds a Back Office section's article « Sur cette page » in its scope only", () => {
    expect(articleFor("/admin/outils/brevo", "fr", { scope: "backOffice", from: BACK_OFFICE })).toBe(PROVIDERS);
    expect(articleFor("/admin/outils", "fr", { scope: "public", from: BACK_OFFICE })).toBeNull();
  });
});

/** #558's Administrator articles: the rest of the Back Office, then « IA et conformité ». */
const BACK_OFFICE_REST = {
  page: {
    "page-admin-dashboard": ["plateforme", "/admin/consommation-ia"],
    "page-admin-activity": ["plateforme", "/admin/activite"],
    "page-admin-audit": ["plateforme", "/admin/activite/actions"],
    "page-admin-plans": ["offre", "/admin/offres"],
    "page-admin-playbooks": ["coaching", "/admin/playbooks"],
    "page-admin-guardrails": ["coaching", "/admin/garde-fous"],
    "page-admin-signalements": ["candidats", "/admin/signalements"],
    "page-admin-unanswered-questions": ["contenu", "/admin/questions-sans-reponse"],
    "page-admin-email-intake": ["plateforme", "/admin/activite/emails-recus"],
    "page-admin-human-coaches": ["coaching", "/admin/coachs"],
  },
  tutorial: {
    "tutorial-admin-plan-stripe": ["offre", null],
    "tutorial-admin-validate-playbook": ["coaching", null],
    "tutorial-admin-guardrail-message": ["coaching", null],
    "tutorial-admin-triage-signalement": ["candidats", null],
    "tutorial-admin-unanswered-question-article": ["contenu", null],
    "tutorial-admin-accept-sender": ["plateforme", null],
    "tutorial-admin-human-coach": ["coaching", null],
  },
  glossary: {
    "glossary-admin-back-office-roles": ["equipe", null],
    "glossary-admin-failure-reason": ["plateforme", null],
    "glossary-admin-human-validated": ["coaching", null],
  },
  faq: {
    "faq-admin-ai-literacy": ["ia-et-conformite", null],
    "faq-admin-annex-iii-note": ["ia-et-conformite", null],
  },
} as const;

describe("the rest of the Back Office's help and « IA et conformité » (#558)", () => {
  it("has 10 pages, 7 tutorials, 3 glossary entries and 2 « IA et conformité » articles, in French and English, Administrators' only", () => {
    for (const locale of ["fr", "en"] as const)
      for (const [kind, expected] of Object.entries(BACK_OFFICE_REST))
        for (const [id, [topic, route]] of Object.entries(expected)) {
          const found = backOfficeHelpArticle(topic, id, locale);
          expect([id, found?.kind, found?.audience, found?.route]).toEqual([id, kind, "administrator", route]);
          expect(helpCentreArticle(topic, id, locale)).toBeNull();
          expect(isPublic(found!)).toBe(false);
        }
  });

  it("shows each section's page « Sur cette page » in the Back Office, its tabs included, and never outside it", () => {
    expect(articleFor("/admin/activite/recherches?periode=7d", "fr", { scope: "backOffice" })?.id).toBe("page-admin-activity");
    expect(articleFor("/admin/activite/appels-ia/abc", "fr", { scope: "backOffice" })?.id).toBe("page-admin-activity");
    expect(articleFor("/admin/activite/actions", "fr", { scope: "backOffice" })?.id).toBe("page-admin-audit");
    expect(articleFor("/admin/activite/emails-recus", "fr", { scope: "backOffice" })?.id).toBe("page-admin-email-intake");
    expect(articleFor("/admin/playbooks/socle", "fr", { scope: "backOffice" })?.id).toBe("page-admin-playbooks");
    expect(articleFor("/admin/signalements/abc", "fr", { scope: "backOffice" })?.id).toBe("page-admin-signalements");
    expect(articleFor("/admin/garde-fous", "fr", { scope: "public" })).toBeNull();
  });

  it("finds them with the Back Office search, without AI", () => {
    expect(search("valider un playbook", "fr", { scope: "backOffice" })[0]?.id).toBe("tutorial-admin-validate-playbook");
    expect(search("relier une offre à Stripe", "fr", { scope: "backOffice" })[0]?.id).toBe("tutorial-admin-plan-stripe");
    expect(search("annexe III haut risque", "fr", { scope: "backOffice" })[0]?.id).toBe("faq-admin-annex-iii-note");
    expect(search("AI literacy article 4", "en", { scope: "backOffice" })[0]?.id).toBe("faq-admin-ai-literacy");
    expect(search("annexe III haut risque", "fr")).toEqual([]);
  });

  it("dates the internal « hors Annexe III » note and gives its sources, in both languages", () => {
    const fr = backOfficeHelpArticle("ia-et-conformite", "faq-admin-annex-iii-note", "fr")!;
    const en = backOfficeHelpArticle("ia-et-conformite", "faq-admin-annex-iii-note", "en")!;
    expect(fr.title).toContain("2 novembre 2026");
    expect(fr.body).toMatch(/Note interne datée du 2 novembre 2026/);
    expect(fr.body).toMatch(/\*\*Sources\.\*\*[\s\S]*2024\/1689[\s\S]*Service Desk[\s\S]*#497/);
    expect(en.title).toContain("2 November 2026");
    expect(en.body).toMatch(/\*\*Sources\.\*\*[\s\S]*2024\/1689[\s\S]*Service Desk[\s\S]*#497/);
  });
});
