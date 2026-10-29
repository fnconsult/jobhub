/**
 * The Tools (#233): every functional external tool Jobbbox calls at runtime, from the web app and
 * the worker, in one catalog. The Back Office's Outils section lists them with their state and
 * their calls; a guard test fails when a call is recorded for a provider not registered here.
 *
 *   toolsByCategory()                     the Tools, grouped, in the Back Office's order
 *   toolById("france-travail")            one Tool, by its id (its Outils page)
 *   toolOfUsage({ table, provider, ... }) the Tool a recorded call was made to
 *
 * A Tool's calls are recorded in one place: `ai_usage` (AI models and web search, by AI provider
 * id and, for Claude, endpoint) or `external_api_usage` (any other API, by provider id). An AI
 * Tool's other calls (its key's connection test, #234) go to `external_api_usage` under its own id.
 * Data residency (ADR-0007) is said only where it was established: "unknown" otherwise.
 * A Tool also names the Platform Settings it depends on (ADR-0033, #304): Paramètres stays the
 * only place they are changed; the Outils section shows them and accounts for them in its state.
 */

/** What a Tool is for, in the Back Office's order. */
export const TOOL_CATEGORIES = [
  "ai_model",
  "web_search",
  "job_discovery",
  "company_data",
  "contact_enrichment",
  "billing",
  "mail",
  "sign_in",
  "geolocation",
  "reference_data",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Where a Tool processes the data it is sent: in the EU, outside it, or not established. */
export type ToolResidency = "eu" | "outside_eu" | "unknown";

/** A text in each language of the app. */
export interface Translated {
  fr: string;
  en: string;
}

/** Where a Tool's calls are recorded. */
export type ToolUsage =
  /**
   * An AI model or web search: `ai_usage.provider`, and the start of `ai_usage.endpoint` when one provider is several Tools (Claude).
   * `external`: the `external_api_usage.provider` its calls that are not AI calls are recorded under (its key's connection test).
   */
  | { table: "ai_usage"; provider: string; endpoint?: string; external?: string }
  /** Any other API, through `recordingFetch`: `external_api_usage.provider`. */
  | { table: "external_api_usage"; provider: string };

/**
 * A setting a Tool depends on: a Platform Setting, or a setting only env holds that Paramètres
 * shows (MAIL_TRANSPORT, the Stripe Prices). Its value is compared as the code reads it.
 */
export interface ToolSetting {
  name: string;
  /** The Tool cannot be called while it is empty: « paramètre manquant ». */
  required?: true;
  /** The Tool is off unless the setting holds one of these values: « désactivé ». */
  enabledWhen?: readonly string[];
  /** The Tool is off while the setting holds one of these values: « désactivé ». */
  disabledWhen?: readonly string[];
}

export interface Tool {
  /** Stable, used in its Outils page's address. */
  id: string;
  name: string;
  purpose: Translated;
  category: ToolCategory;
  /** The module that calls it. */
  module: string;
  runsIn: "web" | "worker" | "both";
  /** The environment variables it cannot be called without (Provider Secrets among them); none for a public API. */
  keys: readonly string[];
  /** The settings it depends on, in the order its page lists them; none when absent. */
  settings?: readonly ToolSetting[];
  /** For a sign-in Tool, the type of Sign-in Provider it is: it is configured when one of that type is enabled. */
  signIn?: "google" | "apple" | "microsoft" | "oidc";
  /** Null while its calls are not recorded. */
  usage: ToolUsage | null;
  residency: ToolResidency;
  /** What the residency depends on, when it does. */
  residencyNote?: Translated;
  /**
   * Its logo, one of the web app's own assets, shown by AI Activity: set only once its owner allowed it in writing
   * (#318). None by default: AI Activity then names the Tool in text. Never a third-party favicon.
   */
  logo?: `/logos/${string}`;
}

const ANTHROPIC_MODULE = "packages/ai/src/providers/anthropic.ts";
const CHAT_COMPLETIONS_MODULE = "packages/ai/src/providers/chat-completions.ts";
const ATS_MODULE = "apps/worker/src/job-discovery/ats.ts";
const ENRICHMENT_MODULE = "apps/web/src/enriched-contacts/providers";
const MAILER_MODULE = "apps/web/src/auth/mailers.ts";
const SIGN_IN_MODULE = "apps/web/src/auth/index.ts";
const REFERENCE_DATA_MODULE = "apps/web/src/reference-data/sources.ts";

const WEB_SEARCH_PURPOSE: Translated = {
  fr: "Recherche web : offres d'emploi, dossiers entreprise et actualités. Ne reçoit que des requêtes bâties sur les critères de recherche ou le nom d'un employeur.",
  en: "Web search: job offers, company dossiers and company news. Receives only queries built from Search Criteria or an employer's name.",
};
const ATS_PURPOSE = (name: string): Translated => ({
  fr: `API publique des offres publiées sur ${name} : lit une offre trouvée par la recherche d'offres.`,
  en: `Public API of the postings on ${name}: reads an offer Job discovery found.`,
});
const ENRICHMENT_PURPOSE: Translated = {
  fr: "Enrichissement de contacts : coordonnées professionnelles d'un contact chez un employeur. Seul le fournisseur actif est appelé.",
  en: "Contact enrichment: a contact's work details at an employer. Only the active provider is called.",
};
/**
 * A Search provider's settings (ADR-0043): the active one and its fallback, then its own typed settings, and for
 * Perplexity and Tavily AI_WEB_SEARCH_MODEL, which their typed settings replace, read for one more release (#398),
 * then the filters Job discovery sends it (#402).
 */
const WEB_SEARCH_SETTINGS = (...own: string[]): readonly ToolSetting[] => [
  { name: "AI_WEB_SEARCH_PROVIDER" },
  { name: "AI_WEB_SEARCH_FALLBACK_PROVIDER" },
  ...own.map((name) => ({ name })),
  // What Job discovery asks of every Search provider (#402): the country favoured, the oldest posting, the results per query.
  { name: "JOB_DISCOVERY_COUNTRY" },
  { name: "JOB_DISCOVERY_MAX_POSTING_AGE_DAYS" },
  { name: "JOB_DISCOVERY_RESULTS_PER_QUERY" },
];
const JOB_DISCOVERY_BUDGET: readonly ToolSetting[] = [{ name: "JOB_DISCOVERY_BUDGET_JOB_OFFERS" }, { name: "JOB_DISCOVERY_BUDGET_EUR" }, { name: "JOB_DISCOVERY_BUDGET_SECONDS" }];
/** Only the chosen provider is called, and only once its data-processing agreement is signed (ADR-0015). */
const ENRICHMENT_SETTINGS = (provider: string): readonly ToolSetting[] => [
  { name: "CONTACT_ENRICHMENT_PROVIDER", enabledWhen: [provider] },
  { name: "CONTACT_ENRICHMENT_DPA_SIGNED", enabledWhen: ["true"] },
];
/** MAIL_TRANSPORT=console writes the emails to the server's log: Brevo is not called. */
const MAIL_SETTINGS: readonly ToolSetting[] = [{ name: "MAIL_FROM" }, { name: "MAIL_TRANSPORT", disabledWhen: ["console"] }];
const SIGN_IN_PURPOSE = (name: string): Translated => ({
  fr: `Connexion avec ${name}, pour les candidats et les administrateurs.`,
  en: `Sign-in with ${name}, for Candidates and Administrators.`,
});

export const TOOLS = [
  {
    id: "anthropic",
    name: "Claude (Anthropic API)",
    purpose: {
      fr: "Modèle d'IA par l'API directe d'Anthropic : tâches sans données personnelles d'abord, chaque appel expurgé.",
      en: "AI model through Anthropic's direct API: tasks without personal data first, every call redacted.",
    },
    category: "ai_model",
    module: ANTHROPIC_MODULE,
    runsIn: "both",
    keys: ["ANTHROPIC_API_KEY"],
    settings: [{ name: "ANTHROPIC_ENDPOINT" }],
    usage: { table: "ai_usage", provider: "anthropic", endpoint: "api.anthropic.com", external: "anthropic" },
    residency: "outside_eu",
  },
  {
    id: "anthropic-bedrock",
    name: "Claude (AWS Bedrock)",
    purpose: {
      fr: "Modèle d'IA Claude hébergé par AWS Bedrock, préféré pour les tâches avec données personnelles.",
      en: "Claude AI model hosted on AWS Bedrock, preferred for tasks with personal data.",
    },
    category: "ai_model",
    module: ANTHROPIC_MODULE,
    runsIn: "both",
    keys: ["AWS_BEARER_TOKEN_BEDROCK"],
    settings: [{ name: "ANTHROPIC_ENDPOINT" }, { name: "BEDROCK_REGION" }],
    usage: { table: "ai_usage", provider: "anthropic", endpoint: "bedrock ", external: "anthropic_bedrock" },
    residency: "eu",
    residencyNote: { fr: "Dans l'UE dans une région eu-* (eu-north-1 par défaut).", en: "In the EU in an eu-* region (eu-north-1 by default)." },
  },
  {
    id: "anthropic-vertex",
    name: "Claude (Google Vertex AI)",
    purpose: {
      fr: "Modèle d'IA Claude hébergé par Google Vertex AI, quand ANTHROPIC_ENDPOINT=vertex.",
      en: "Claude AI model hosted on Google Vertex AI, when ANTHROPIC_ENDPOINT=vertex.",
    },
    category: "ai_model",
    module: ANTHROPIC_MODULE,
    runsIn: "both",
    keys: [],
    settings: [{ name: "ANTHROPIC_ENDPOINT", enabledWhen: ["vertex"] }, { name: "VERTEX_REGION" }, { name: "VERTEX_PROJECT_ID", required: true }],
    usage: { table: "ai_usage", provider: "anthropic", endpoint: "vertex " },
    residency: "eu",
    residencyNote: { fr: "Dans l'UE dans une région europe-* ou « eu » (europe-west1 par défaut).", en: "In the EU in a europe-* or \"eu\" region (europe-west1 by default)." },
  },
  {
    id: "mistral",
    name: "Mistral AI",
    purpose: {
      fr: "Modèle d'IA hébergé dans l'UE : route d'identité des candidats ayant donné leur consentement IA UE, et toute tâche qui lui est confiée.",
      en: "AI model hosted in the EU: the identity route of Candidates with EU AI consent, and any task routed to it.",
    },
    category: "ai_model",
    module: CHAT_COMPLETIONS_MODULE,
    runsIn: "both",
    keys: ["MISTRAL_API_KEY"],
    settings: [{ name: "AI_IDENTITY_MODEL" }],
    usage: { table: "ai_usage", provider: "mistral", external: "mistral" },
    residency: "eu",
    residencyNote: { fr: "Dans l'UE (api.eu.mistral.ai, inférence régionale UE et AELE).", en: "In the EU (api.eu.mistral.ai, EU and EFTA regional inference)." },
  },
  {
    id: "openai",
    name: "OpenAI",
    purpose: {
      fr: "Modèle d'IA, pour les tâches qui lui sont confiées et les agents de playbook.",
      en: "AI model, for the tasks routed to it and Playbook Agents.",
    },
    category: "ai_model",
    module: CHAT_COMPLETIONS_MODULE,
    runsIn: "both",
    keys: ["OPENAI_API_KEY"],
    settings: [{ name: "OPENAI_DATA_RESIDENCY" }],
    usage: { table: "ai_usage", provider: "openai" },
    residency: "outside_eu",
    residencyNote: { fr: "Dans l'UE seulement avec un projet OpenAI en région UE.", en: "In the EU only with an OpenAI project in the EU region." },
  },
  {
    id: "perplexity",
    name: "Perplexity",
    purpose: WEB_SEARCH_PURPOSE,
    category: "web_search",
    module: "packages/ai/src/providers/perplexity.ts",
    runsIn: "both",
    keys: ["PERPLEXITY_API_KEY"],
    settings: WEB_SEARCH_SETTINGS("PERPLEXITY_SEARCH_TYPE", "PERPLEXITY_QUERIES_PER_CALL", "AI_WEB_SEARCH_MODEL", "PERPLEXITY_FAST_SEARCH_PRICE_USD", "PERPLEXITY_SEARCH_PRICE_USD"),
    usage: { table: "ai_usage", provider: "perplexity", external: "perplexity" },
    residency: "outside_eu",
  },
  {
    id: "brave",
    name: "Brave Search",
    purpose: WEB_SEARCH_PURPOSE,
    category: "web_search",
    module: "packages/ai/src/providers/brave.ts",
    runsIn: "both",
    keys: ["BRAVE_SEARCH_API_KEY"],
    settings: WEB_SEARCH_SETTINGS("BRAVE_MAX_PAGES", "BRAVE_SEARCH_PRICE_USD"),
    usage: { table: "ai_usage", provider: "brave", external: "brave" },
    residency: "outside_eu",
  },
  {
    id: "tavily",
    name: "Tavily",
    purpose: WEB_SEARCH_PURPOSE,
    category: "web_search",
    module: "packages/ai/src/providers/tavily.ts",
    runsIn: "both",
    keys: ["TAVILY_API_KEY"],
    settings: WEB_SEARCH_SETTINGS("TAVILY_SEARCH_DEPTH", "AI_WEB_SEARCH_MODEL", "TAVILY_CREDIT_PRICE_USD"),
    usage: { table: "ai_usage", provider: "tavily", external: "tavily" },
    residency: "outside_eu",
  },
  {
    id: "france-travail",
    name: "France Travail",
    purpose: {
      fr: "API de France Travail pour la recherche d'offres : ses offres d'emploi, les entreprises cibles de La Bonne Boite et les codes ROME de ROMEO. Ne reçoit que le métier et le lieu des critères de recherche.",
      en: "France Travail's APIs for Job discovery: its job offers, La Bonne Boite's Target Companies and ROMEO's ROME codes. Receives only the Search Criteria's job and place.",
    },
    category: "job_discovery",
    module: "apps/worker/src/job-discovery/france-travail/api.ts",
    runsIn: "worker",
    keys: ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
    settings: JOB_DISCOVERY_BUDGET,
    usage: { table: "external_api_usage", provider: "france_travail" },
    residency: "eu",
    residencyNote: { fr: "Service public français ; aucune donnée personnelle envoyée.", en: "French public service; no personal data sent." },
    // La Bonne Boite's terms ask for it where its companies are shown (#409); the owner's OK and its source are on #424.
    logo: "/logos/france-travail.svg",
  },
  {
    id: "fantastic-jobs",
    name: "Fantastic.jobs",
    purpose: {
      fr: "API des offres publiées sur les ATS des employeurs (active-ats) : la recherche d'offres. Ne reçoit que les critères de recherche.",
      en: "API of the postings on employers' ATS (active-ats): Job discovery. Receives only Search Criteria.",
    },
    category: "job_discovery",
    module: "apps/worker/src/job-discovery/fantastic-jobs/api.ts",
    runsIn: "worker",
    keys: ["FANTASTIC_JOBS_API_KEY"],
    usage: { table: "external_api_usage", provider: "fantastic_jobs" },
    residency: "eu",
    residencyNote: { fr: "Société néerlandaise ; aucune donnée personnelle envoyée.", en: "Dutch company; no personal data sent." },
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    purpose: ATS_PURPOSE("Greenhouse"),
    category: "job_discovery",
    module: ATS_MODULE,
    runsIn: "worker",
    keys: [],
    usage: { table: "external_api_usage", provider: "greenhouse" },
    residency: "outside_eu",
  },
  {
    id: "lever",
    name: "Lever",
    purpose: ATS_PURPOSE("Lever"),
    category: "job_discovery",
    module: ATS_MODULE,
    runsIn: "worker",
    keys: [],
    usage: { table: "external_api_usage", provider: "lever" },
    residency: "outside_eu",
  },
  {
    id: "ashby",
    name: "Ashby",
    purpose: ATS_PURPOSE("Ashby"),
    category: "job_discovery",
    module: ATS_MODULE,
    runsIn: "worker",
    keys: [],
    usage: { table: "external_api_usage", provider: "ashby" },
    residency: "outside_eu",
  },
  {
    id: "apec",
    name: "APEC",
    purpose: {
      fr: "Pages d'offres de l'APEC, lues quand la recherche d'offres en trouve une.",
      en: "APEC's offer pages, read when Job discovery finds one.",
    },
    category: "job_discovery",
    module: "packages/shared/src/page-reading/polite-fetch.ts",
    runsIn: "worker",
    keys: [],
    usage: { table: "external_api_usage", provider: "apec" },
    residency: "eu",
    residencyNote: { fr: "Opérateur français ; aucune donnée personnelle envoyée.", en: "French operator; no personal data sent." },
  },
  {
    id: "job-site",
    name: "Sites d'emploi",
    purpose: {
      fr: "Pages des autres sites d'emploi et d'entreprise : lues par la recherche d'offres et par la vérification des offres suivies. Seul le domaine du site est enregistré, jamais l'adresse de la page.",
      en: "Pages of other job and company sites: read by Job discovery and by the source re-check. Only the site's domain is recorded, never the page's address.",
    },
    category: "job_discovery",
    module: "apps/worker/src/job-discovery/polite-fetch.ts",
    runsIn: "worker",
    keys: [],
    settings: JOB_DISCOVERY_BUDGET,
    usage: { table: "external_api_usage", provider: "job_site" },
    residency: "unknown",
    residencyNote: { fr: "Selon le site ; aucune donnée personnelle envoyée.", en: "Depends on the site; no personal data sent." },
  },
  {
    id: "recherche-entreprises",
    name: "recherche-entreprises.api.gouv.fr",
    purpose: {
      fr: "Registre public des entreprises françaises : identité légale d'un employeur pour son dossier entreprise.",
      en: "Public register of French companies: an employer's legal identity for its Company Dossier.",
    },
    category: "company_data",
    module: "apps/web/src/company-dossiers/french-register.ts",
    runsIn: "web",
    keys: [],
    usage: { table: "external_api_usage", provider: "recherche_entreprises" },
    residency: "eu",
    residencyNote: { fr: "Service public français ; ne reçoit que le nom d'un employeur.", en: "French public service; receives only an employer's name." },
  },
  {
    id: "lusha",
    name: "Lusha",
    purpose: ENRICHMENT_PURPOSE,
    category: "contact_enrichment",
    module: `${ENRICHMENT_MODULE}/lusha.ts`,
    runsIn: "web",
    keys: ["LUSHA_API_KEY"],
    settings: ENRICHMENT_SETTINGS("lusha"),
    usage: { table: "external_api_usage", provider: "lusha" },
    residency: "outside_eu",
  },
  {
    id: "kaspr",
    name: "Kaspr",
    purpose: ENRICHMENT_PURPOSE,
    category: "contact_enrichment",
    module: `${ENRICHMENT_MODULE}/kaspr.ts`,
    runsIn: "web",
    keys: ["KASPR_API_KEY"],
    settings: ENRICHMENT_SETTINGS("kaspr"),
    usage: { table: "external_api_usage", provider: "kaspr" },
    residency: "unknown",
  },
  {
    id: "apollo",
    name: "Apollo",
    purpose: ENRICHMENT_PURPOSE,
    category: "contact_enrichment",
    module: `${ENRICHMENT_MODULE}/apollo.ts`,
    runsIn: "web",
    keys: ["APOLLO_API_KEY"],
    settings: ENRICHMENT_SETTINGS("apollo"),
    usage: { table: "external_api_usage", provider: "apollo" },
    residency: "outside_eu",
  },
  {
    id: "stripe",
    name: "Stripe",
    purpose: {
      fr: "Paiements et abonnements : paiement, portail client, prix, codes promo et webhooks.",
      en: "Payments and subscriptions: checkout, customer portal, prices, coupons and webhooks.",
    },
    category: "billing",
    module: "apps/web/src/billing/index.ts",
    runsIn: "web",
    keys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    settings: [{ name: "STRIPE_PRICE_STANDARD" }, { name: "STRIPE_PRICE_PREMIUM" }, { name: "STRIPE_PRICE_COACHING_SESSION" }, { name: "STRIPE_PRICE_COACHING_SESSION_PREMIUM" }],
    usage: { table: "external_api_usage", provider: "stripe" },
    residency: "outside_eu",
  },
  {
    id: "brevo-api",
    name: "Brevo (API)",
    purpose: {
      fr: "Envoi des e-mails transactionnels par l'API de Brevo : liens de connexion, relances, Job Digests, alertes.",
      en: "Transactional emails through Brevo's API: sign-in links, Follow-ups, Job Digests, alerts.",
    },
    category: "mail",
    module: MAILER_MODULE,
    runsIn: "both",
    keys: ["BREVO_API_KEY"],
    settings: MAIL_SETTINGS,
    usage: { table: "external_api_usage", provider: "brevo" },
    residency: "unknown",
  },
  {
    id: "brevo-smtp",
    name: "Brevo (SMTP)",
    purpose: {
      fr: "Envoi des e-mails transactionnels par le relais SMTP de Brevo, sans clé d'API.",
      en: "Transactional emails through Brevo's SMTP relay, without an API key.",
    },
    category: "mail",
    module: MAILER_MODULE,
    runsIn: "both",
    keys: ["SMTP_URL"],
    settings: MAIL_SETTINGS,
    usage: { table: "external_api_usage", provider: "brevo_smtp" },
    residency: "unknown",
  },
  {
    // Email intake (#442, ADR-0050): Brevo Inbound Parsing posts each email sent to a Candidate's Forwarding address to
    // the webhook, with the shared secret; it calls Jobbbox, never the other way, so no call is recorded. The Tool of the
    // Email intake Job discovery source: its sheet is on the Sources tab of Paramètres (#448).
    id: "brevo-inbound",
    name: "Brevo (Inbound Parsing)",
    purpose: {
      fr: "Réception par email : reçoit les mails d'offres que les candidats transfèrent à leur adresse de transfert ; seul leur texte est lu.",
      en: "Email intake: receives the offer emails Candidates forward to their Forwarding address; only their text is read.",
    },
    category: "job_discovery",
    module: "apps/web/src/email-intake/inbound.ts",
    runsIn: "web",
    keys: ["BREVO_INBOUND_SECRET"],
    settings: [{ name: "EMAIL_INTAKE_DOMAIN" }, { name: "EMAIL_INTAKE_BREVO_IP_RANGES" }, { name: "EMAIL_INTAKE_DAILY_CAP" }, { name: "EMAIL_INTAKE_BROAD_FILTER_THRESHOLD" }],
    usage: null,
    residency: "eu",
  },
  {
    id: "google",
    name: "Google",
    purpose: SIGN_IN_PURPOSE("Google"),
    category: "sign_in",
    module: SIGN_IN_MODULE,
    runsIn: "web",
    keys: [],
    signIn: "google",
    usage: { table: "external_api_usage", provider: "google" },
    residency: "outside_eu",
  },
  {
    id: "apple",
    name: "Apple",
    purpose: SIGN_IN_PURPOSE("Apple"),
    category: "sign_in",
    module: SIGN_IN_MODULE,
    runsIn: "web",
    keys: [],
    signIn: "apple",
    usage: { table: "external_api_usage", provider: "apple" },
    residency: "outside_eu",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    purpose: SIGN_IN_PURPOSE("Microsoft"),
    category: "sign_in",
    module: SIGN_IN_MODULE,
    runsIn: "web",
    keys: [],
    signIn: "microsoft",
    usage: { table: "external_api_usage", provider: "microsoft" },
    residency: "outside_eu",
  },
  {
    id: "oidc",
    name: "OpenID Connect",
    purpose: {
      fr: "Connexion par un fournisseur OpenID Connect configuré dans Connexion (Okta, Entra ID…).",
      en: "Sign-in through an OpenID Connect provider configured in Connexion (Okta, Entra ID…).",
    },
    category: "sign_in",
    module: SIGN_IN_MODULE,
    runsIn: "web",
    keys: [],
    signIn: "oidc",
    usage: { table: "external_api_usage", provider: "oidc" },
    residency: "unknown",
    residencyNote: { fr: "Selon l'émetteur configuré.", en: "Depends on the configured issuer." },
  },
  {
    id: "geo-api-gouv",
    name: "geo.api.gouv.fr",
    purpose: {
      fr: "Découpage administratif de l'État (communes, départements, régions) : suggère les lieux des critères de recherche pendant la saisie, et donne la commune autour de laquelle La Bonne Boite cherche les entreprises cibles.",
      en: "The French state's administrative divisions (communes, départements, régions): suggests the places of the Search Criteria while typing, and gives the commune La Bonne Boite looks for Target Companies around.",
    },
    category: "geolocation",
    module: "apps/web/src/places/geo-api.ts",
    runsIn: "both",
    keys: [],
    usage: { table: "external_api_usage", provider: "geo-api-gouv" },
    residency: "eu",
    residencyNote: { fr: "Service public français ; ne reçoit qu'un nom de lieu ou un code postal.", en: "French public service; receives only a place name or postcode." },
  },
  {
    id: "insee-naf",
    name: "INSEE (rdf.insee.fr)",
    purpose: {
      fr: "Nomenclature NAF rév. 2 de l'INSEE : les libellés des secteurs et sous-secteurs des critères de recherche, mis en cache et rafraîchis chaque mois.",
      en: "INSEE's NAF rév. 2 nomenclature: the labels of the Search Criteria's Sectors and Subsectors, cached and refreshed monthly.",
    },
    category: "reference_data",
    module: REFERENCE_DATA_MODULE,
    runsIn: "both",
    keys: [],
    usage: { table: "external_api_usage", provider: "insee-naf" },
    residency: "eu",
    residencyNote: { fr: "Service public français ; ne reçoit aucune donnée.", en: "French public service; receives no data." },
  },
  {
    id: "rome-open-data",
    name: "ROME open data (France Travail)",
    purpose: {
      fr: "Données ouvertes du ROME 4.0 de France Travail : les libellés des domaines professionnels des critères de recherche, mis en cache et rafraîchis chaque mois.",
      en: "France Travail's ROME 4.0 open data: the labels of the Search Criteria's professional Domains, cached and refreshed monthly.",
    },
    category: "reference_data",
    module: REFERENCE_DATA_MODULE,
    runsIn: "both",
    keys: [],
    usage: { table: "external_api_usage", provider: "rome-open-data" },
    residency: "eu",
    residencyNote: { fr: "Service public français ; ne reçoit aucune donnée.", en: "French public service; receives no data." },
  },
] as const satisfies readonly Tool[];

export type ToolId = (typeof TOOLS)[number]["id"];

type Usages = (typeof TOOLS)[number]["usage"];

/** The providers recorded in `external_api_usage`: what `recordingFetch` and `recordingClient` may be given. */
export type ExternalApiProvider = Extract<Usages, { table: "external_api_usage" }>["provider"] | Extract<Usages, { external: string }>["external"];

/** The `external_api_usage.provider` ids `tool`'s calls are recorded under: none for an AI Tool without a connection test. */
export function externalApiProvidersOf(tool: Tool): string[] {
  const usage = tool.usage;
  if (!usage) return [];
  if (usage.table === "external_api_usage") return [usage.provider];
  return usage.external ? [usage.external] : [];
}

/** The providers recorded in `ai_usage`: every AI provider id must be one. */
export type AiUsageProvider = Extract<(typeof TOOLS)[number]["usage"], { table: "ai_usage" }>["provider"];

/** The Tool with this id; none for any other. */
export function toolById(id: string): Tool | undefined {
  return (TOOLS as readonly Tool[]).find((tool) => tool.id === id);
}

/** The Tools, by category in TOOL_CATEGORIES' order; a category no Tool is in is left out. */
export function toolsByCategory(): { category: ToolCategory; tools: Tool[] }[] {
  return TOOL_CATEGORIES.map((category) => ({ category, tools: (TOOLS as readonly Tool[]).filter((tool) => tool.category === category) })).filter(
    (group) => group.tools.length > 0,
  );
}

/** A call as recorded: its table, its provider, and for `ai_usage` the endpoint that served it. */
export type RecordedCall = { table: "ai_usage"; provider: string; endpoint: string } | { table: "external_api_usage"; provider: string };

/** The Tool a recorded call was made to; none when its provider is not registered. */
export function toolOfUsage(call: RecordedCall): Tool | undefined {
  if (call.table === "external_api_usage") return (TOOLS as readonly Tool[]).find((tool) => externalApiProvidersOf(tool).includes(call.provider));
  return (TOOLS as readonly Tool[]).find((tool) => {
    const usage = tool.usage;
    if (!usage || usage.table !== "ai_usage" || usage.provider !== call.provider) return false;
    return usage.endpoint === undefined || call.endpoint.startsWith(usage.endpoint);
  });
}
