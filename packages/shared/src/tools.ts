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
  "delivery",
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
  /**
   * It receives personal data, or queries drawn from it (web search): a recipient, as the Recipient list names it
   * (ADR-0064). Outside the EU, or where its residency was not established, the privacy policy in effect must name it.
   */
  receivesPersonalData: boolean;
  /** What the residency depends on, when it does. */
  residencyNote?: Translated;
  /**
   * Its logo, one of the web app's own assets, shown by AI Activity: set only once its owner allowed it in writing
   * (#318). None by default: AI Activity then names the Tool in text. Never a third-party favicon.
   */
  logo?: `/logos/${string}`;
  /**
   * What the Recipient list says of it (ADR-0064, #338), set for every Tool that receives personal data but one that
   * runs on Jobbbox's own servers (`hostedBy`).
   */
  recipient?: RecipientFacts;
  /** For a Tool that runs on Jobbbox's own servers, the Host it runs on: the Host is the recipient, not the Tool. */
  hostedBy?: HostId;
}

/**
 * What a recipient is sent, in the Recipient list's words (ADR-0064): after Redaction, queries only, identity under EU
 * AI Consent, and what the other recipients are sent (RECIPIENT_DATA_TEXT).
 */
export const RECIPIENT_DATA = [
  "redacted",
  "queries_only",
  "identity_under_eu_ai_consent",
  "forwarded_emails",
  "account",
  "payment",
  "emails_sent",
  "sign_in",
  "contact_search",
  "hosted",
  "video_viewing",
] as const;
export type RecipientData = (typeof RECIPIENT_DATA)[number];

/**
 * What a transfer outside the EU rests on (GDPR art. 45 and 46), in the Recipient list's words: none needed (it stays in
 * the EU), an adequacy decision, the EU-U.S. Data Privacy Framework as the provider declares it, the Commission's
 * standard contractual clauses, or not established.
 */
export const TRANSFER_SAFEGUARDS = ["none_needed", "adequacy", "dpf", "scc", "not_established"] as const;
export type TransferSafeguard = (typeof TRANSFER_SAFEGUARDS)[number];

/**
 * A recipient's public facts (ADR-0064), from `docs/research/issue-522.md` (#522): its public name (the provider and the
 * model family, never a model version; a text name, no logo), what it is for in plain words, what it is sent, the
 * entity Jobbbox contracts with, where it processes the data and what a transfer outside the EU rests on.
 */
export interface RecipientFacts {
  name: string;
  purpose: Translated;
  data: readonly RecipientData[];
  entity: string | Translated;
  place: Translated;
  safeguards: readonly TransferSafeguard[];
}

/** The Recipient list's words for what a recipient is sent. */
export const RECIPIENT_DATA_TEXT: Record<RecipientData, Translated> = {
  redacted: {
    fr: "Vos textes (CV, candidatures, messages au coach), sans votre nom, votre adresse, votre e-mail ni votre téléphone. Le reste, comme vos employeurs, vos postes et vos dates, part tel quel : ce sont encore des données personnelles, dites pseudonymisées.",
    en: "Your texts (CV, applications, messages to the coach), without your name, address, email or phone number. The rest, such as your employers, positions and dates, goes as it is: it is still personal data, called pseudonymised.",
  },
  queries_only: {
    fr: "Des requêtes seulement : un métier, un lieu ou le nom d'un employeur, jamais votre identité.",
    en: "Queries only: a job, a place or an employer's name, never your identity.",
  },
  identity_under_eu_ai_consent: {
    fr: "Votre identité (nom, coordonnées), seulement si vous avez donné votre consentement IA UE.",
    en: "Your identity (name, contact details), only if you gave your EU AI Consent.",
  },
  forwarded_emails: {
    fr: "Le texte des e-mails d'offres que vous transférez à Jobbbox, qui peut nommer un recruteur.",
    en: "The text of the offer emails you forward to Jobbbox, which may name a recruiter.",
  },
  account: {
    fr: "Votre adresse e-mail et l'identifiant de votre compte Jobbbox.",
    en: "Your email address and your Jobbbox account's identifier.",
  },
  payment: {
    fr: "Vos achats et vos paiements. Vous saisissez votre carte directement chez Stripe : Jobbbox ne la voit pas.",
    en: "Your purchases and payments. You enter your card directly with Stripe: Jobbbox never sees it.",
  },
  emails_sent: {
    fr: "Votre adresse e-mail, votre prénom et le contenu des e-mails que Jobbbox vous envoie.",
    en: "Your email address, your first name and the content of the emails Jobbbox sends you.",
  },
  sign_in: {
    fr: "Votre connexion : ce service vous identifie, puis transmet à Jobbbox votre adresse e-mail et votre nom.",
    en: "Your sign-in: this service identifies you, then passes your email address and name to Jobbbox.",
  },
  contact_search: {
    fr: "Le nom d'un employeur et des intitulés de poste ; il renvoie les coordonnées professionnelles d'un contact chez cet employeur.",
    en: "An employer's name and job titles; it returns the work contact details of a person at that employer.",
  },
  hosted: {
    fr: "Toutes les données de Jobbbox, stockées sur son serveur.",
    en: "All of Jobbbox's data, stored on its server.",
  },
  video_viewing: {
    fr: "Votre adresse IP et les informations techniques de votre navigateur, quand vous affichez ou lancez une vidéo d'aide. Rien de votre compte.",
    en: "Your IP address and your browser's technical information, when you display or play a help video. Nothing from your account.",
  },
};

/** The Recipient list's words for what a transfer rests on. */
export const TRANSFER_SAFEGUARD_TEXT: Record<TransferSafeguard, Translated> = {
  none_needed: { fr: "Aucun transfert hors UE.", en: "No transfer outside the EU." },
  adequacy: { fr: "Décision d'adéquation de la Commission européenne.", en: "An adequacy decision of the European Commission." },
  dpf: {
    fr: "Data Privacy Framework UE–États-Unis, auquel le fournisseur déclare adhérer.",
    en: "The EU–U.S. Data Privacy Framework, which the provider declares it adheres to.",
  },
  scc: { fr: "Clauses contractuelles types de la Commission européenne.", en: "The European Commission's standard contractual clauses." },
  not_established: { fr: "Non établie à ce jour.", en: "Not established to date." },
};

/** Where Jobbbox itself runs: a recipient of everything it stores, listed whatever the Tools switched on. */
export interface Host {
  id: string;
  residency: ToolResidency;
  recipient: RecipientFacts;
}

/** The Hosts of Jobbbox (`docs/ops/hosting.md`): its own server, and Scaleway, which serves the help videos (#568). */
export const HOSTS = [
  {
    id: "hostinger",
    residency: "eu",
    recipient: {
      name: "Hostinger",
      purpose: {
        fr: "Héberge Jobbbox : son serveur, sa base de données et la réception des e-mails que vous transférez.",
        en: "Hosts Jobbbox: its server, its database and the reception of the emails you forward.",
      },
      data: ["hosted"],
      entity: "Hostinger International Limited",
      place: { fr: "Dans l'UE : centre de données de Paris (Hostinger International Limited est établie à Chypre).", en: "In the EU: Paris data centre (Hostinger International Limited is based in Cyprus)." },
      safeguards: ["none_needed"],
    },
  },
  {
    // The Help Centre's Explainer Videos (ADR-0066, #568): a bucket in fr-par served at media.jobbbox.ai, which sees the
    // address of whoever displays a video's poster or plays it. An EU host: a minor change under ADR-0064.
    id: "scaleway",
    residency: "eu",
    recipient: {
      name: "Scaleway",
      purpose: {
        fr: "Héberge les vidéos d'aide du centre d'aide et vous les envoie quand vous les affichez ou les lancez.",
        en: "Hosts the Help Centre's help videos and sends them to you when you display or play them.",
      },
      data: ["video_viewing"],
      entity: "Scaleway SAS",
      place: { fr: "Dans l'UE : région de Paris (fr-par) ; Scaleway SAS est établie en France.", en: "In the EU: Paris region (fr-par); Scaleway SAS is based in France." },
      safeguards: ["none_needed"],
    },
  },
] as const satisfies readonly Host[];
export type HostId = (typeof HOSTS)[number]["id"];

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

const WEB_SEARCH_PUBLIC_PURPOSE: Translated = {
  fr: "Recherche sur le web : trouve des offres d'emploi et des informations sur les employeurs.",
  en: "Web search: finds job offers and information about employers.",
};
const JOB_DISCOVERY_PUBLIC_PURPOSE: Translated = {
  fr: "Offres d'emploi : trouve les offres qui correspondent à vos critères de recherche.",
  en: "Job offers: finds the offers that match your Search Criteria.",
};
const ENRICHMENT_PUBLIC_PURPOSE: Translated = {
  fr: "Trouve les coordonnées professionnelles d'un contact chez un employeur, quand vous le demandez (offre Premium).",
  en: "Finds a person's work contact details at an employer, when you ask for them (Premium).",
};
const BREVO_RECIPIENT: RecipientFacts = {
  name: "Brevo",
  purpose: {
    fr: "Envoi des e-mails de Jobbbox : liens de connexion, sélections d'offres, rappels et avis.",
    en: "Sends Jobbbox's emails: sign-in links, Job Digests, reminders and notices.",
  },
  data: ["emails_sent"],
  entity: "Brevo SAS",
  place: {
    fr: "Dans l'UE (France et Belgique) ; le support et la diffusion des e-mails peuvent passer hors UE.",
    en: "In the EU (France and Belgium); support and email delivery may go outside the EU.",
  },
  safeguards: ["dpf", "scc"],
};
const signInRecipient = (name: string, entity: string, safeguards: readonly TransferSafeguard[]): RecipientFacts => ({
  name,
  purpose: { fr: `Connexion à Jobbbox avec votre compte ${name}, si vous la choisissez.`, en: `Sign-in to Jobbbox with your ${name} account, if you choose it.` },
  data: ["sign_in"],
  entity,
  place: { fr: "Hors UE : États-Unis et d'autres pays.", en: "Outside the EU: United States and other countries." },
  safeguards,
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
    receivesPersonalData: true,
    recipient: {
      name: "Claude (Anthropic)",
      purpose: {
        fr: "Modèle d'IA : lit votre CV, calcule vos scores, rédige vos documents adaptés et répond dans vos conversations avec le coach IA.",
        en: "AI model: reads your CV, works out your scores, writes your tailored documents and answers in your conversations with the AI Coach.",
      },
      data: ["redacted"],
      entity: "Anthropic Ireland, Limited",
      place: {
        fr: "Hors UE : aux États-Unis, ou dans tout autre pays où Anthropic fait tourner ses modèles. Données gardées 30 jours, ou jusqu'à 2 ans si un contrôle de sécurité les signale ; jamais utilisées pour entraîner ses modèles.",
        en: "Outside the EU: in the United States, or in any other country where Anthropic runs its models. Data kept 30 days, or up to 2 years if a safety check flags it; never used to train its models.",
      },
      safeguards: ["scc"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Claude (AWS Bedrock)",
      purpose: {
        fr: "Modèle d'IA Claude, hébergé par Amazon Web Services : les mêmes tâches que Claude par l'API d'Anthropic.",
        en: "The Claude AI model, hosted by Amazon Web Services: the same tasks as Claude through Anthropic's API.",
      },
      data: ["redacted", "identity_under_eu_ai_consent"],
      entity: "Amazon Web Services EMEA SARL",
      place: { fr: "Dans l'UE : une région européenne d'AWS.", en: "In the EU: a European AWS region." },
      safeguards: ["none_needed"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Claude (Google Vertex AI)",
      purpose: {
        fr: "Modèle d'IA Claude, hébergé par Google Cloud : les mêmes tâches que Claude par l'API d'Anthropic.",
        en: "The Claude AI model, hosted by Google Cloud: the same tasks as Claude through Anthropic's API.",
      },
      data: ["redacted", "identity_under_eu_ai_consent"],
      entity: "Google Cloud EMEA Limited",
      place: { fr: "Dans l'UE : une région européenne de Google Cloud.", en: "In the EU: a European Google Cloud region." },
      safeguards: ["none_needed"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Mistral AI",
      purpose: {
        fr: "Modèle d'IA hébergé dans l'UE : traite ce qui porte votre identité si vous avez donné votre consentement IA UE, et lit les e-mails d'offres que vous transférez.",
        en: "AI model hosted in the EU: handles what carries your identity if you gave your EU AI Consent, and reads the offer emails you forward.",
      },
      data: ["identity_under_eu_ai_consent", "forwarded_emails"],
      entity: "Mistral AI SAS",
      place: {
        fr: "Dans l'UE : centres de données de l'UE et de l'AELE (dont la Suisse, couverte par une décision d'adéquation), par le point d'accès européen de Mistral.",
        en: "In the EU: data centres in the EU and EFTA (including Switzerland, covered by an adequacy decision), through Mistral's European endpoint.",
      },
      safeguards: ["none_needed", "adequacy"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "OpenAI",
      purpose: {
        fr: "Modèle d'IA, pour les tâches que Jobbbox lui confie.",
        en: "AI model, for the tasks Jobbbox gives it.",
      },
      data: ["redacted"],
      entity: "OpenAI Ireland Limited",
      place: {
        fr: "Hors UE, sauf avec un projet OpenAI en région UE.",
        en: "Outside the EU, unless with an OpenAI project in the EU region.",
      },
      safeguards: ["scc"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Perplexity",
      purpose: WEB_SEARCH_PUBLIC_PURPOSE,
      data: ["queries_only"],
      entity: "Perplexity AI, Inc.",
      place: {
        fr: "Hors UE : États-Unis. Ses clauses contractuelles types ne couvrent peut-être pas son API de recherche.",
        en: "Outside the EU: United States. Its standard contractual clauses may not cover its search API.",
      },
      safeguards: ["not_established"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Brave Search",
      purpose: WEB_SEARCH_PUBLIC_PURPOSE,
      data: ["queries_only"],
      entity: "Brave Software, Inc.",
      place: { fr: "Hors UE : États-Unis. Requêtes gardées 90 jours au plus.", en: "Outside the EU: United States. Queries kept 90 days at most." },
      safeguards: ["not_established"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Tavily",
      purpose: WEB_SEARCH_PUBLIC_PURPOSE,
      data: ["queries_only"],
      entity: "AlphaAI Technologies Inc. (Tavily)",
      place: {
        fr: "Hors UE : États-Unis. Tavily peut réutiliser les requêtes pour améliorer son service.",
        en: "Outside the EU: United States. Tavily may reuse the queries to improve its service.",
      },
      safeguards: ["not_established"],
    },
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
    // Queries drawn from the Search Criteria, as web search's (ADR-0064): a recipient, in the EU.
    receivesPersonalData: true,
    recipient: {
      name: "France Travail",
      purpose: JOB_DISCOVERY_PUBLIC_PURPOSE,
      data: ["queries_only"],
      entity: { fr: "France Travail, opérateur public", en: "France Travail, public operator" },
      place: { fr: "Dans l'UE : France.", en: "In the EU: France." },
      safeguards: ["none_needed"],
    },
    residencyNote: { fr: "Service public français ; ne reçoit que le métier et le lieu des critères de recherche.", en: "French public service; receives only the Search Criteria's job and place." },
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
    // A Dutch company, but where it processes the queries was not found (#522): not established.
    residency: "unknown",
    // Queries drawn from the Search Criteria, as web search's (ADR-0064): a recipient.
    receivesPersonalData: true,
    recipient: {
      name: "Fantastic.jobs",
      purpose: JOB_DISCOVERY_PUBLIC_PURPOSE,
      data: ["queries_only"],
      entity: "Fantastic.jobs",
      place: {
        fr: "Non établi : société établie à Amsterdam, dont le lieu de traitement n'est pas publié.",
        en: "Not established: a company based in Amsterdam, which does not publish where it processes data.",
      },
      safeguards: ["not_established"],
    },
    residencyNote: { fr: "Société néerlandaise ; lieu de traitement non publié. Ne reçoit que les critères de recherche.", en: "Dutch company; place of processing not published. Receives only Search Criteria." },
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: true,
    recipient: {
      name: "Lusha",
      purpose: ENRICHMENT_PUBLIC_PURPOSE,
      data: ["contact_search"],
      entity: "Lusha Systems, Inc.",
      place: { fr: "Hors UE : Israël, avec un hébergement en Irlande.", en: "Outside the EU: Israel, hosted in Ireland." },
      safeguards: ["adequacy", "scc"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Kaspr",
      purpose: ENRICHMENT_PUBLIC_PURPOSE,
      data: ["contact_search"],
      entity: "KASPR SAS",
      place: {
        fr: "Dans l'UE autant que possible, selon Kaspr ; le lieu n'est pas établi.",
        en: "In the EU as far as possible, according to Kaspr; the place is not established.",
      },
      safeguards: ["scc"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Apollo",
      purpose: ENRICHMENT_PUBLIC_PURPOSE,
      data: ["contact_search"],
      entity: "ZenLeads Inc. (Apollo.io)",
      place: { fr: "Hors UE : États-Unis.", en: "Outside the EU: United States." },
      safeguards: ["dpf", "scc"],
    },
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
    receivesPersonalData: true,
    recipient: {
      name: "Stripe",
      purpose: {
        fr: "Paiement de vos abonnements et de vos séances de coaching. Stripe traite aussi ces données pour ses propres obligations, comme la lutte contre la fraude et le blanchiment.",
        en: "Payment of your subscriptions and coaching sessions. Stripe also processes this data for its own obligations, such as fighting fraud and money laundering.",
      },
      data: ["account", "payment"],
      entity: "Stripe Payments Europe, Limited",
      place: {
        fr: "Hors UE : Stripe, LLC aux États-Unis, et d'autres pays.",
        en: "Outside the EU: Stripe, LLC in the United States, and other countries.",
      },
      safeguards: ["dpf", "scc"],
    },
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
    receivesPersonalData: true,
    recipient: BREVO_RECIPIENT,
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
    receivesPersonalData: true,
    recipient: BREVO_RECIPIENT,
  },
  {
    // Email intake (#442, #580): Jobbbox's own MTA (Haraka, apps/mta, on the VPS) receives each email sent to a
    // Candidate's Forwarding address and posts it to the app's door with the shared secret; it calls Jobbbox, never the
    // other way, so no call is recorded. The Tool of the Email intake Job discovery source: its sheet is on the Sources
    // tab of Paramètres (#448).
    id: "email-intake",
    name: "MTA Jobbbox (Haraka)",
    purpose: {
      fr: "Réception par email : reçoit les mails d'offres que les candidats transfèrent à leur adresse de transfert ; seul leur texte est lu.",
      en: "Email intake: receives the offer emails Candidates forward to their Forwarding address; only their text is read.",
    },
    category: "job_discovery",
    module: "apps/web/src/email-intake/inbound.ts",
    runsIn: "web",
    keys: ["EMAIL_INTAKE_INBOUND_SECRET"],
    settings: [{ name: "EMAIL_INTAKE_DOMAIN" }, { name: "EMAIL_INTAKE_MTA_IP_RANGES" }, { name: "EMAIL_INTAKE_DAILY_CAP" }, { name: "EMAIL_INTAKE_BROAD_FILTER_THRESHOLD" }],
    usage: null,
    residency: "eu",
    receivesPersonalData: true,
    hostedBy: "hostinger",
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
    receivesPersonalData: true,
    recipient: signInRecipient("Google", "Google Ireland Limited", ["dpf", "scc"]),
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
    receivesPersonalData: true,
    recipient: signInRecipient("Apple", "Apple Distribution International Limited", ["scc"]),
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
    receivesPersonalData: true,
    recipient: signInRecipient("Microsoft", "Microsoft Ireland Operations Limited", ["dpf", "scc"]),
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
    receivesPersonalData: true,
    recipient: {
      name: "OpenID Connect",
      purpose: {
        fr: "Connexion par le fournisseur d'identité de votre organisation.",
        en: "Sign-in through your organisation's identity provider.",
      },
      data: ["sign_in"],
      entity: { fr: "Le fournisseur d'identité configuré.", en: "The identity provider configured." },
      place: { fr: "Selon le fournisseur d'identité configuré ; non établi.", en: "Depends on the identity provider configured; not established." },
      safeguards: ["not_established"],
    },
    residencyNote: { fr: "Selon l'émetteur configuré.", en: "Depends on the configured issuer." },
  },
  {
    // Two-step verification (#663, ADR-0075): Jobbbox checks the code itself, nothing leaves it. Its calls are the
    // second steps tried, each with its outcome, so the failures are counted in Outils; never the code nor who tried.
    id: "two-step-verification",
    name: "Vérification en deux étapes",
    purpose: {
      fr: "Vérification en deux étapes : vérifie, dans Jobbbox, le code d'une application d'authentification ou un code de secours. Chaque essai est compté, jamais le code.",
      en: "Two-step verification: checks, within Jobbbox, an authenticator app's code or a backup code. Each attempt is counted, never the code.",
    },
    category: "sign_in",
    module: "apps/web/src/two-step-verification/index.ts",
    runsIn: "web",
    keys: [],
    usage: { table: "external_api_usage", provider: "two_step_verification" },
    residency: "eu",
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
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
    receivesPersonalData: false,
    residencyNote: { fr: "Service public français ; ne reçoit aucune donnée.", en: "French public service; receives no data." },
  },
  {
    id: "github",
    name: "GitHub",
    purpose: {
      fr: "API de GitHub, lue avec un jeton en lecture seule : la page Livraison et son e-mail quotidien (tickets, pull requests et déploiements de Jobbbox). Ne reçoit aucune donnée de Jobbbox.",
      en: "GitHub's API, read with a read-only token: the Livraison page and its daily email (Jobbbox's tickets, pull requests and deployments). Receives no Jobbbox data.",
    },
    category: "delivery",
    module: "apps/web/src/delivery-status",
    runsIn: "both",
    keys: ["GITHUB_STATUS_TOKEN"],
    // Who gets Livraison's daily email; empty, nobody.
    settings: [{ name: "DELIVERY_STATUS_EMAIL_TO" }],
    usage: { table: "external_api_usage", provider: "github" },
    residency: "outside_eu",
    receivesPersonalData: false,
    residencyNote: { fr: "Société américaine ; lue seulement, aucune donnée personnelle envoyée.", en: "US company; only read, no personal data sent." },
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

/**
 * Whether `tool` is a recipient outside the EU (ADR-0064): it receives personal data, or queries drawn from it, outside
 * the EU or where that was not established, which counts as outside. The privacy policy in effect must name it (#548).
 */
export function isRecipientOutsideEu(tool: Tool): boolean {
  return tool.receivesPersonalData && tool.residency !== "eu";
}

/** A recipient as the Recipient list shows it (ADR-0064): a Host or a Tool, where it processes the data, and its facts. */
export interface ListedRecipient {
  id: string;
  kind: "host" | "tool";
  /** `unknown` counts as outside the EU (ADR-0007, ADR-0064). */
  residency: ToolResidency;
  facts: RecipientFacts;
}

/**
 * The Recipient list (ADR-0064, #338): Jobbbox's Hosts, then each Tool `switchedOn` that receives personal data, or
 * queries drawn from it, in the catalog's order, each recipient once. A Tool that runs on Jobbbox's own servers is its
 * Host's.
 */
export function recipientList(switchedOn: (tool: Tool) => boolean): ListedRecipient[] {
  const hosts = (HOSTS as readonly Host[]).map((host): ListedRecipient => ({ id: host.id, kind: "host", residency: host.residency, facts: host.recipient }));
  const tools = (TOOLS as readonly Tool[])
    .filter((tool) => tool.receivesPersonalData && tool.recipient && switchedOn(tool))
    .map((tool): ListedRecipient => ({ id: tool.id, kind: "tool", residency: tool.residency, facts: tool.recipient! }));
  // Two Tools of one recipient (Brevo's API and its SMTP relay) are listed once, as the first.
  const named = new Set<string>();
  return [...hosts, ...tools].filter((recipient) => !named.has(recipient.facts.name) && named.add(recipient.facts.name));
}

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
