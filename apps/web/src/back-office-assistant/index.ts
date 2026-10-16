/**
 * The Back Office Assistant (CONTEXT.md, #205): the AI Coach panel shown to
 * Administrators in the Back Office. It answers questions about Back Office data
 * and settings, and is read-only: it never changes anything.
 *
 * One deep module. Callers get `createBackOfficeAssistant({ ai, sources }).reply(administrator, input)`
 * where `input` is untrusted (it comes from the browser): `{ messages }`. It never throws
 * for a bad conversation or a failing provider: it answers `{ ok: false, error: "invalid" | "unavailable" }`.
 *
 * What the assistant is told is built here, for the asking Administrator's Back Office
 * Roles: a source is read only when one of their roles may read its section, so data
 * outside their roles is never read, let alone put in the prompt; the sections they
 * may not read are named, for the assistant to refuse. It is never given Provider
 * Secret or SSO client secret values, not even masked: no source carries them.
 * Personal data is minimised (GDPR art. 5(1)(c)): no email address goes in (Administrators
 * are counted per role, Journal targets are masked, Human Coaches go by their public
 * name and bio), and any address left in the context is masked as a last resort.
 *
 * Task `coaching`, EU endpoints only (ADR-0007), on behalf of the Administrator's own
 * Candidate account: identity-bearing calls (an address or phone number they type)
 * go to Mistral when they gave EU AI consent (#121). Its replies cost Jobbbox, not a
 * Plan Quota: nothing is counted against one.
 */
import { costInEur, type AiLayer } from "@jobhub/ai";
import { PLANS, type Plan, type PlanQuotas } from "@jobhub/shared";
import * as z from "zod";
import { BACK_OFFICE_ROLES, type BackOfficeAccess, type BackOfficeResource, type BackOfficeRole } from "../admin/access";
import type { Administrator } from "../admin/administrators";
import type { BackOfficeAuditEntry, Recorded } from "../admin/back-office";
import type { CoachMessageCost } from "../coach";
import { COACH_MESSAGE_COST_TARGET_EUR, type CoachCostDay } from "../coach-conversations";
import type { HumanCoach } from "../human-coaches";
import { routes } from "../routes";

/** One message of a conversation with the Back Office Assistant. */
export interface AssistantMessage {
  from: "administrator" | "assistant";
  text: string;
}

/** Longest single message, and most messages the assistant answers from. */
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_MESSAGES = 40;

/** The Back Office data the assistant reads, each source covered by one Back Office resource. */
export interface BackOfficeAssistantSources {
  /** Every Plan's quotas (`planQuotas`). */
  planQuotas(): Promise<Record<Plan, PlanQuotas>>;
  /** The Human Coaches Candidates can choose from (`humanCoaches`). */
  humanCoaches(): Promise<HumanCoach[]>;
  /** The AI Coach's cost per day, newest first (`coachMessageCost`). */
  coachCost(days: number): Promise<CoachCostDay[]>;
  /** The Administrators and their roles (`roles`). */
  administrators(): Promise<Administrator[]>;
  /** The Back Office Audit, newest first (`audit`). */
  journal(limit: number): Promise<BackOfficeAuditEntry[]>;
}

/** Who is asking: their Candidate id (for EU AI consent) and what their roles allow. */
export interface AskingAdministrator {
  id: string;
  access: Pick<BackOfficeAccess, "roles" | "can">;
}

export type AssistantReply = { ok: true; reply: string; cost: CoachMessageCost } | { ok: false; error: "invalid" | "unavailable" };

export interface BackOfficeAssistant {
  reply(administrator: AskingAdministrator, input: unknown): Promise<AssistantReply>;
}

export interface BackOfficeAssistantDeps {
  ai: AiLayer;
  sources: BackOfficeAssistantSources;
}

/** Days of AI Coach cost, Journal entries and Human Coaches the assistant is told about at most. */
const COST_DAYS = 14;
const JOURNAL_ENTRIES = 30;
const HUMAN_COACHES = 50;
const BIO_LENGTH = 200;

const inputSchema = z.object({
  messages: z
    .array(z.object({ from: z.enum(["administrator", "assistant"]), text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }))
    .min(1)
    .max(MAX_MESSAGES * 5)
    .refine((messages) => messages.at(-1)?.from === "administrator"),
});

/** The last MAX_MESSAGES messages, starting with an Administrator's message. */
export function recentMessages<T extends AssistantMessage>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const start = recent.findIndex((message) => message.from === "administrator");
  return start === -1 ? [] : recent.slice(start);
}

const PERSONA = `Tu es l'assistant du Back Office de Jobbbox, pour les Administrateurs (l'équipe Jobbbox).
Règles :
- Réponds dans la langue de l'Administrateur, en phrases courtes et claires. En français, vouvoie-le.
- Tu es en lecture seule : tu ne modifies rien et ne peux rien modifier. Pour un changement, indique la page du Back Office où l'Administrateur peut le faire lui-même, si ses rôles le permettent.
- Appuie-toi uniquement sur les données et les explications ci-dessous. N'invente jamais de chiffre ni de réglage.
- Tu ne connais aucune valeur de clé de fournisseur (Provider Secrets) ni de secret de connexion (SSO), même masquée : si on te les demande, refuse et dis que tu n'y as jamais accès.
- Pour une section hors des rôles de l'Administrateur, refuse poliment : dis que ses rôles ne lui donnent pas accès à cette section, sans rien deviner ni révéler.
- Les adresses e-mail et autres données personnelles ne te sont pas données : pour savoir qui, renvoie à la page concernée.`;

const ROLE_NAMES: Record<BackOfficeRole, string> = {
  "super-admin": "Super-admin",
  "plans-manager": "Responsable des offres",
  "coach-manager": "Responsable coaching",
  support: "Support",
};

const PLAN_NAMES: Record<Plan, string> = { free: "Free", standard: "Standard", premium: "Premium" };

/** Each Back Office section as the assistant names it, and the page it is on (when there is one yet). */
const SECTIONS: Record<BackOfficeResource, { name: string; page?: string }> = {
  planQuotas: { name: "Quotas des offres (Plan Quotas)", page: routes.adminPlanQuotas },
  plans: { name: "Offres (Plans) et leurs fonctionnalités" },
  humanCoaches: { name: "Coachs humains", page: routes.adminHumanCoaches },
  coachMessageCost: { name: "Coût du coach IA (Coach Message Cost)", page: routes.adminCoachCost },
  roles: { name: "Administrateurs et rôles du Back Office", page: routes.adminAdministrators },
  audit: { name: "Journal du Back Office", page: routes.adminJournal() },
  providerSecrets: { name: "Clés des fournisseurs (Provider Secrets)" },
  ssoProviders: { name: "Fournisseurs de connexion (SSO)" },
};

const heading = (resource: BackOfficeResource) => {
  const { name, page } = SECTIONS[resource];
  return `## ${name}${page ? ` (page ${page})` : ""}`;
};

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}/gi;
/** Masks every email address: none goes to the AI. */
const withoutEmails = (text: string) => text.replace(EMAIL, "[adresse masquée]");

const QUOTA_NAMES: Record<keyof PlanQuotas, string> = {
  profiles: "profils détenus à la fois",
  matchScores: "Match Scores par mois",
  atsScores: "ATS Scores par mois",
  enrichedContacts: "contacts enrichis par mois",
  jobSearches: "recherches d'offres par mois",
  jobDigest: "fréquence du Job Digest",
};

function quotaValue(key: keyof PlanQuotas, value: PlanQuotas[keyof PlanQuotas]): string {
  if (key === "jobDigest") return value === "none" ? "aucun" : value === "daily" ? "quotidien" : "hebdomadaire";
  if (value === null) return "illimité";
  return value === 0 ? "non inclus (0)" : String(value);
}

/** What each section the Administrator may read says, read from its source. */
const SECTION_TEXT: Partial<Record<BackOfficeResource, (sources: BackOfficeAssistantSources) => Promise<string>>> = {
  async planQuotas(sources) {
    const quotas = await sources.planQuotas();
    const lines = PLANS.map(
      (plan) =>
        `- ${PLAN_NAMES[plan]} : ${(Object.keys(QUOTA_NAMES) as (keyof PlanQuotas)[]).map((key) => `${QUOTA_NAMES[key]} ${quotaValue(key, quotas[plan][key])}`).join(" ; ")}`,
    );
    return [
      heading("planQuotas"),
      "Limites d'usage de chaque offre. Les quotas mensuels se comptent par mois civil (heure de Paris). Une modification s'applique immédiatement à tous les candidats de l'offre. Un candidat qui atteint un quota voit une invitation à passer à l'offre supérieure (Upgrade Prompt).",
      ...lines,
    ].join("\n");
  },

  async plans() {
    return [
      heading("plans"),
      `Les offres sont ${PLANS.map((plan) => PLAN_NAMES[plan]).join(", ")}. Leurs prix viennent de Stripe, jamais du Back Office. Les séances de coaching se paient à part, avec une remise en Premium.`,
    ].join("\n");
  },

  async humanCoaches(sources) {
    const coaches = await sources.humanCoaches();
    const lines = coaches
      .slice(0, HUMAN_COACHES)
      // Their public name and bio only: their email and booking link stay out.
      .map((coach) => `- ${coach.name}${coach.bio ? ` : ${coach.bio.slice(0, BIO_LENGTH)}` : ""}`);
    return [
      heading("humanCoaches"),
      `Les professionnels RH que les candidats réservent pour des séances de coaching payantes. ${coaches.length} coach(s) en activité (les coachs retirés ne sont pas listés) :`,
      ...(lines.length ? lines : ["- aucun"]),
    ].join("\n");
  },

  async coachMessageCost(sources) {
    const days = await sources.coachCost(COST_DAYS);
    const lines = days.map(
      (day) =>
        `- ${day.day} : ${day.messages} réponses, médiane ${day.medianEur.toFixed(4)} €, p90 ${day.p90Eur.toFixed(4)} €, ` +
        `${day.inputTokens} jetons en entrée, ${day.cachedInputTokens} en cache, ${day.outputTokens} en sortie ; ` +
        `modèles : ${day.models.map((model) => `${model.provider} ${model.model} (${model.messages})`).join(", ")}`,
    );
    return [
      heading("coachMessageCost"),
      `Coût estimé (prix publics) d'une réponse du coach IA aux candidats, par jour (heure de Paris), sur les ${COST_DAYS} derniers jours. Objectif : ${COACH_MESSAGE_COST_TARGET_EUR} € par réponse au plus.`,
      ...(lines.length ? lines : ["- aucune réponse sur la période"]),
    ].join("\n");
  },

  async roles(sources) {
    const administrators = await sources.administrators();
    // Counted, never named: who holds a role is on the Administrateurs page.
    const lines = BACK_OFFICE_ROLES.map((role) => `- ${ROLE_NAMES[role]} : ${administrators.filter((one) => one.roles.includes(role)).length}`);
    const permanent = administrators.filter((one) => one.permanent).length;
    return [
      heading("roles"),
      "Rôles : Super-admin (tout, y compris les rôles, les clés des fournisseurs et la connexion SSO), Responsable des offres (offres et quotas), Responsable coaching (coachs humains, lecture du coût du coach IA), Support (lecture seule, sans secrets). Seuls les super-admins donnent ou retirent des rôles ; les super-admins permanents (ADMIN_EMAILS) ne peuvent pas être retirés.",
      `${administrators.length} Administrateur(s), dont ${permanent} super-admin(s) permanent(s). Par rôle :`,
      ...lines,
    ].join("\n");
  },

  async audit(sources) {
    const entries = await sources.journal(JOURNAL_ENTRIES);
    const lines = entries.map((entry) => `- ${entry.at.toISOString().slice(0, 16).replace("T", " ")} UTC : ${journalLine(entry)}`);
    return [
      heading("audit"),
      `Chaque changement fait dans le Back Office, gardé 3 ans. Les ${JOURNAL_ENTRIES} derniers, du plus récent au plus ancien (qui l'a fait : voir le Journal) :`,
      ...(lines.length ? lines : ["- aucun"]),
    ].join("\n");
  },
};

const JOURNAL_SECTIONS: Record<BackOfficeAuditEntry["section"], string> = {
  roles: "rôles",
  plan_quotas: "quotas",
  human_coaches: "coachs humains",
  provider_secrets: "clés des fournisseurs",
};

const ACTIONS: Record<BackOfficeAuditEntry["action"], string> = { added: "ajout", updated: "modification", retired: "retrait", replaced: "remplacement" };

/** A Journal entry for the assistant: never a secret (none is recorded), never an address, Human Coaches by name. */
function journalLine(entry: BackOfficeAuditEntry): string {
  const named = (value: Recorded) => (value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string" ? value.name : null);
  const target = entry.section === "human_coaches" ? (named(entry.after) ?? named(entry.before) ?? "un coach") : entry.target;
  const values =
    entry.section === "plan_quotas" || entry.section === "roles" ? ` ; avant ${JSON.stringify(entry.before)}, après ${JSON.stringify(entry.after)}` : "";
  return `${JOURNAL_SECTIONS[entry.section]}, ${ACTIONS[entry.action]} de ${target}${values}`;
}

/** What the assistant is told about the Back Office, for what `access` may read. */
async function assistantContext(sources: BackOfficeAssistantSources, access: AskingAdministrator["access"]): Promise<string> {
  const resources = Object.keys(SECTIONS) as BackOfficeResource[];
  const readable = resources.filter((resource) => access.can(resource, "read"));
  const texts = await Promise.all(readable.flatMap((resource) => SECTION_TEXT[resource]?.(sources) ?? []));
  const outside = resources.filter((resource) => !readable.includes(resource));
  const context = [
    `# Ce que vous savez du Back Office`,
    `Rôles de l'Administrateur : ${access.roles.map((role) => ROLE_NAMES[role]).join(", ")}.`,
    ...texts,
    readable.includes("providerSecrets") || readable.includes("ssoProviders")
      ? "Les valeurs des clés des fournisseurs et des secrets SSO ne vous sont jamais données, même à un super-admin."
      : "",
    outside.length ? `## Hors des rôles de l'Administrateur : refusez d'en parler\n${outside.map((resource) => `- ${SECTIONS[resource].name}`).join("\n")}` : "",
  ];
  return withoutEmails(context.filter(Boolean).join("\n\n"));
}

export function createBackOfficeAssistant(deps: BackOfficeAssistantDeps): BackOfficeAssistant {
  return {
    async reply(administrator, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const messages = recentMessages(parsed.data.messages);
      try {
        const context = await assistantContext(deps.sources, administrator.access);
        const result = await deps.ai.generate({
          task: "coaching",
          // The Administrator's own account: their EU AI consent routes what they type (#121).
          candidateId: administrator.id,
          system: `${PERSONA}\n\n${context}`,
          // The context carries no one's identity; the AI layer's scan catches any in their messages.
          containsIdentity: false,
          prompt: messages.map((message) => ({ role: message.from === "administrator" ? ("user" as const) : ("assistant" as const), content: message.text })),
        });
        const { provider, model, usage } = result;
        return {
          ok: true,
          reply: result.text.trim(),
          cost: {
            provider,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            eur: costInEur(result),
          },
        };
      } catch (error) {
        console.warn("[back-office-assistant] the assistant could not reply:", error instanceof Error ? error.message : error);
        return { ok: false, error: "unavailable" };
      }
    },
  };
}
