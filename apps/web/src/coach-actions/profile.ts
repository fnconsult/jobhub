/**
 * The Coach Actions of the « Profil » group (#719, ADR-0077): what the AI Coach proposes about a Profile and the Coach
 * Memory, applied by the Candidate through the Profiles (../profiles) and Coach Memory (../coach-memory) modules, the
 * ones the Profile's page and the Coach Memory's routes call.
 *
 *  - `propose_search_criteria`: the fields changed (places through Place suggestion, role, Sectors, salary…), before →
 *    after, from the version seen; « Annuler » puts the criteria before back. Copies text.
 *  - `propose_master_cv_changes`: edits on what the Master CV says (rephrase, reorder, cut, put forward), reviewed change
 *    by change in the Work Pane like a Tailored CV (ADR-0006): never an item or a figure it does not have; a rephrasing
 *    with words of the Candidate's Job Offers it lacks is a Flagged Change; the changes accepted, sent explicitly, make one
 *    Master CV Version from the version seen (newer since: a conflict). No one-click « Appliquer ». « Annuler » is a
 *    Restore of the version before. Copies text.
 *  - `propose_profile_archive` / `propose_profile_restore`: within the Plan Quota (restoring uses one active Profile; the
 *    Upgrade prompt without room). « Annuler » does the other. Copy no text. An Archived Profile is out of every other
 *    Coach Action's reach; restoring finds one by its id or its name.
 *  - `propose_coach_memory`: one key fact to remember, each confirmed on its own card (30 items of 300 characters at
 *    most); « Annuler » forgets it while unchanged. Copies text. It replaces the Coach Memory's former « Que retenir de
 *    cette conversation ? » proposals while Coach Actions are on.
 * The Coach never deletes nor creates a Profile: creating one is « Créer un profil » (/profils/nouveau, #657).
 */
import {
  CONTRACT_TYPES,
  distinctLocations,
  industryLabels,
  MAX_SEARCH_LOCATIONS,
  NO_INDUSTRY_REFERENCE,
  REMOTE_WORK_OPTIONS,
  type IndustryReference,
  type SearchCriteria,
} from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { createHash } from "node:crypto";
import * as z from "zod";
import type { UpgradePrompt } from "../billing/upgrade-prompt";
import { COACH_MEMORY_KINDS, MAX_ITEM_LENGTH, MAX_ITEMS, sameFact, type CoachMemory } from "../coach-memory";
import { readOrigin } from "../origin";
import type { PlaceSuggestions } from "../places/geo-api";
import { searchCriteriaSchema, searchCriteriaVersion, type Profile, type Profiles } from "../profiles";
import { acceptedMasterCv, masterCvReview } from "../profiles/master-cv-proposal";
import { routes } from "../routes";
import { defineCoachAction, masterCvEditSchema, type ApplyProposalResult, type CoachAction, type CoachActionResult, type ProposalCall, type ProposedChange, type UndoProposalResult } from "./index";

export const PROFILE_ACTIONS = {
  searchCriteria: "propose_search_criteria",
  masterCv: "propose_master_cv_changes",
  archive: "propose_profile_archive",
  restore: "propose_profile_restore",
  coachMemory: "propose_coach_memory",
} as const;

/** The domain modules the Profil group reads and applies through, for the session's Candidate only. */
export interface ProfileActionSources {
  profiles: Pick<Profiles, "get" | "list" | "changeSearchCriteria" | "saveMasterCv" | "masterCvVersions" | "archive" | "restore">;
  coachMemory: Pick<CoachMemory, "list" | "confirm" | "delete">;
  /** Place suggestion: a place the AI Coach names, as the Locations input would offer it. */
  places: PlaceSuggestions;
  /** The text of the Job Offers of a Profile's Applications: what a Master CV rephrasing is checked against (Flagged Change). */
  offersOf(candidateId: string, profileId: string): Promise<string[]>;
  /** The Upgrade prompt, in `language`, when the Plan Quota leaves no room for one more active Profile; null with room. */
  profileUpgradePrompt(candidateId: string, language: "fr" | "en"): Promise<UpgradePrompt | null>;
  /** The Sectors' and Domains' labels; their codes without it. */
  industries?: () => Promise<IndustryReference>;
}

const id = z.string().trim().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const refused = (reason: string): CoachActionResult => ({ ok: false, error: "refused", reason });
const originOf = ({ cardId, at }: ProposalCall) => ({ origin: "coach_proposal" as const, cardId, appliedAt: at });

/** Text compared without case, accents nor spacing. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** An active Profile of the Candidate's; null for another Candidate's, an Archived one or an unknown id. */
async function activeProfile(sources: ProfileActionSources, candidateId: string, profileId: string): Promise<Profile | null> {
  const profile = await sources.profiles.get(candidateId, profileId);
  return profile && !profile.archived ? profile : null;
}

// ——— Search Criteria ———

/** The criteria a proposal can change, in the order its card tells them. */
const CRITERIA = ["targetRole", "locations", "minSalary", "contractTypes", "remoteWorkOptions", "sectors", "subsectors", "domains"] as const;
type Criterion = (typeof CRITERIA)[number];
/** Each criterion's label, as the Search Criteria's form names it. */
const CRITERION_LABELS = {
  targetRole: "cvReview.targetRole",
  locations: "cvReview.locations",
  minSalary: "cvReview.minSalary",
  contractTypes: "cvReview.contractType",
  remoteWorkOptions: "cvReview.remoteWork",
  sectors: "cvReview.sectors",
  subsectors: "cvReview.sectors",
  domains: "cvReview.domains",
} as const satisfies Record<Criterion, string>;
/** The ones « Modifier avant d'appliquer » offers as the page's form does: text; the others are chosen on the page. */
const EDITABLE: readonly Criterion[] = ["targetRole", "locations", "minSalary"];

const searchCriteriaArgs = z.object({
  profileId: id.describe("L'id du profil (actif) dont les critères changent."),
  targetRole: z.string().trim().min(1).max(120).optional().describe("Le nouveau poste recherché."),
  addLocations: z.array(z.string().trim().min(1).max(100)).max(MAX_SEARCH_LOCATIONS).optional().describe("Les lieux à ajouter (ville, département, région)."),
  removeLocations: z.array(z.string().trim().min(1).max(100)).max(MAX_SEARCH_LOCATIONS).optional().describe("Les lieux à retirer, tels qu'écrits dans les critères."),
  minSalary: z.number().int().positive().max(10_000_000).nullable().optional().describe("Le salaire annuel brut minimum en euros ; null pour ne plus en demander."),
  contractTypes: z.array(z.enum(CONTRACT_TYPES)).optional().describe("Les types de contrat voulus, tous (remplace la liste ; vide : aucune préférence)."),
  remoteWorkOptions: z.array(z.enum(REMOTE_WORK_OPTIONS)).optional().describe("Les options de télétravail voulues, toutes (remplace la liste)."),
  sectors: z.array(z.string().max(4)).optional().describe("Les codes NAF des secteurs voulus, tous (remplace la liste)."),
  subsectors: z.array(z.string().max(4)).optional().describe("Les codes NAF des sous-secteurs voulus, tous (remplace la liste)."),
  domains: z.array(z.string().max(4)).optional().describe("Les codes ROME des domaines voulus, tous (remplace la liste)."),
});

/** `name` as Place suggestion would offer it: the suggestion named the same (« Lyon » → « Lyon (69) »), else as written. */
async function placeOf(places: PlaceSuggestions, name: string): Promise<string> {
  const suggestions = await places.suggest(name).catch(() => []);
  const bare = (place: string) => folded(place.replace(/\s*\([^)]*\)\s*$/, ""));
  return suggestions.find((suggestion) => bare(suggestion.name) === folded(name))?.name ?? name;
}

/** One criterion in words, for a card: « Lieux : Paris, Lyon (69) »; « — » for none. */
function criterionInWords(criterion: Criterion, criteria: SearchCriteria, language: "fr" | "en", industries: IndustryReference): string {
  const { t } = createI18n(language);
  const list = (values: readonly string[]) => (values.length > 0 ? values.join(", ") : "—");
  const value = (() => {
    switch (criterion) {
      case "targetRole":
        return criteria.targetRole;
      case "locations":
        return list(criteria.locations);
      case "minSalary":
        return criteria.minSalary === undefined ? "—" : new Intl.NumberFormat(language === "en" ? "en-GB" : "fr-FR").format(criteria.minSalary);
      case "contractTypes":
        return list(criteria.contractTypes.map((type) => t(`cvReview.contractTypes.${type}`)));
      case "remoteWorkOptions":
        return list(criteria.remoteWorkOptions.map((option) => t(`cvReview.remoteWorkOptions.${option}`)));
      case "sectors":
      case "subsectors":
        return list(industryLabels({ sectors: criteria.sectors, subsectors: criteria.subsectors, domains: [] }, industries, language).sectors);
      case "domains":
        return list(industryLabels({ sectors: [], subsectors: [], domains: criteria.domains }, industries, language).domains);
    }
  })();
  return `${t(CRITERION_LABELS[criterion])} : ${value}`;
}

/** A criterion as the card's `value` holds it: text, one place per line, codes separated by commas. */
function criterionValue(criterion: Criterion, criteria: SearchCriteria): string {
  const value = criteria[criterion];
  if (value === undefined) return "";
  if (criterion === "locations") return (value as string[]).join("\n");
  return Array.isArray(value) ? value.join(",") : String(value);
}

/** The criteria a card's `value` sets on `current`: what the page's route takes, the same validation. */
function criteriaFrom(current: SearchCriteria, value: Record<string, string>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const criterion of CRITERIA) {
    const text = value[criterion];
    if (text === undefined) continue;
    if (criterion === "targetRole") next.targetRole = text;
    else if (criterion === "locations") next.locations = text.split("\n");
    else if (criterion === "minSalary") {
      if (text.trim() === "") delete next.minSalary;
      else next.minSalary = Number(text.replace(/[\s\u202f\u00a0]/g, ""));
    } else next[criterion] = text.split(",").filter(Boolean);
  }
  return next;
}

function searchCriteriaAction(sources: ProfileActionSources): CoachAction {
  const undoSchema = z.object({ profileId: z.string(), before: z.record(z.string(), z.unknown()), origin: z.unknown(), version: z.string() });
  return defineCoachAction({
    name: PROFILE_ACTIONS.searchCriteria,
    description:
      "Propose de changer les critères de recherche d'un profil actif du candidat (poste recherché, lieux à ajouter ou retirer, salaire minimum, types de contrat, télétravail, secteurs, domaines), seulement ceux qu'il demande de changer. Le candidat applique ou ignore la proposition.",
    schema: searchCriteriaArgs,
    group: "profile",
    kind: "propose",
    copiesText: true,
    async run(args, { candidateId, language }) {
      const profile = await activeProfile(sources, candidateId, args.profileId);
      if (!profile) return NOT_FOUND;
      const current = profile.searchCriteria;
      const added = await Promise.all((args.addLocations ?? []).map((place) => placeOf(sources.places, place)));
      const removed = new Set((args.removeLocations ?? []).map(folded));
      const locations = [...current.locations.filter((place) => !removed.has(folded(place))), ...added];
      const wanted: Record<string, unknown> = {
        ...current,
        locations,
        ...(args.targetRole !== undefined ? { targetRole: args.targetRole } : {}),
        ...(args.contractTypes ? { contractTypes: args.contractTypes } : {}),
        ...(args.remoteWorkOptions ? { remoteWorkOptions: args.remoteWorkOptions } : {}),
        ...(args.sectors ? { sectors: args.sectors } : {}),
        ...(args.subsectors ? { subsectors: args.subsectors } : {}),
        ...(args.domains ? { domains: args.domains } : {}),
      };
      if (args.minSalary === null) delete wanted.minSalary;
      else if (args.minSalary !== undefined) wanted.minSalary = args.minSalary;
      if (distinctLocations(locations).length > MAX_SEARCH_LOCATIONS) return refused(`Au plus ${MAX_SEARCH_LOCATIONS} lieux par profil : propose d'en retirer avant d'en ajouter.`);
      const parsed = searchCriteriaSchema.safeParse(wanted);
      if (!parsed.success) return refused(`Ces critères ne conviennent pas (${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}) : rien n'a été proposé.`);
      const next = parsed.data as SearchCriteria;
      const changed = CRITERIA.filter((criterion) => JSON.stringify(current[criterion] ?? null) !== JSON.stringify(next[criterion] ?? null));
      if (changed.length === 0) return refused("Ces critères sont déjà ceux du profil : rien à proposer.");

      const { t } = createI18n(language);
      const industries = (await sources.industries?.().catch(() => NO_INDUSTRY_REFERENCE)) ?? NO_INDUSTRY_REFERENCE;
      const words = (criteria: SearchCriteria) => changed.map((criterion) => criterionInWords(criterion, criteria, language, industries)).join(" · ");
      const change: ProposedChange = {
        target: { kind: "profile", id: profile.id, name: profile.name, href: routes.profile(profile.id) },
        what: t("cvReview.searchCriteria"),
        before: words(current),
        after: words(next),
        value: Object.fromEntries(changed.map((criterion) => [criterion, criterionValue(criterion, next)])),
        fields: changed
          .filter((criterion) => EDITABLE.includes(criterion))
          .map((criterion) => ({ name: criterion, label: t(CRITERION_LABELS[criterion]), type: criterion === "locations" ? ("textarea" as const) : ("text" as const) })),
        version: searchCriteriaVersion(current),
      };
      return { ok: true, data: change, pages: [routes.profile(profile.id)] };
    },
    async apply(change, call): Promise<ApplyProposalResult> {
      const profile = await sources.profiles.get(call.candidateId, change.target.id);
      if (!profile || profile.archived) return NOT_FOUND;
      if (searchCriteriaVersion(profile.searchCriteria) !== change.version) return { ok: false, error: "conflict" };
      const changed = await sources.profiles.changeSearchCriteria(
        call.candidateId,
        profile.id,
        { searchCriteria: criteriaFrom(profile.searchCriteria, change.value) },
        { basedOn: change.version, origin: originOf(call) },
      );
      if (changed.ok) {
        const undo = { profileId: profile.id, before: profile.searchCriteria, origin: profile.searchCriteriaOrigin ?? null, version: searchCriteriaVersion(changed.profile.searchCriteria) };
        return { ok: true, undo };
      }
      if ("errors" in changed) return { ok: false, error: "invalid", errors: changed.errors };
      return { ok: false, error: changed.error === "conflict" ? "conflict" : "not_found" };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = undoSchema.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { profileId, before, origin, version } = kept.data;
      const restored = await sources.profiles.changeSearchCriteria(candidateId, profileId, { searchCriteria: before }, { basedOn: version, origin: readOrigin(origin) });
      if (restored.ok) return { ok: true };
      return { ok: false, error: "errors" in restored || restored.error !== "not_found" ? "conflict" : "not_found" };
    },
  });
}

// ——— Master CV ———

function masterCvAction(sources: ProfileActionSources): CoachAction {
  const undoSchema = z.object({ profileId: z.string(), before: z.number().int(), version: z.number().int() });
  return defineCoachAction({
    name: PROFILE_ACTIONS.masterCv,
    description:
      "Propose des modifications du CV de référence d'un profil actif, que le candidat relira une par une : reformuler (le titre, le résumé, un poste, une compétence), couper, réordonner ou mettre en avant (en premier) un élément. Uniquement ce que le CV dit déjà : jamais un élément, un chiffre ni un fait qu'il ne contient pas. Un élément est nommé comme le CV l'écrit (un poste par son intitulé ou son employeur).",
    schema: z.object({ profileId: id.describe("L'id du profil (actif) dont le CV de référence change."), changes: z.array(masterCvEditSchema).min(1).max(20) }),
    group: "profile",
    kind: "propose",
    copiesText: true,
    async run({ profileId, changes }, { candidateId, language }) {
      const profile = await activeProfile(sources, candidateId, profileId);
      if (!profile) return NOT_FOUND;
      const offers = await sources.offersOf(candidateId, profile.id).catch(() => []);
      const review = masterCvReview(profile.masterCv.content, changes, { offers });
      if (!review.ok) {
        switch (review.error) {
          case "unknown_item":
            return refused(`« ${review.item} » n'est pas dans le CV de référence : propose seulement de reformuler, couper, réordonner ou mettre en avant ce qu'il dit déjà, nommé comme il l'écrit.`);
          case "invented_figure":
            return refused(`« ${review.text} » avance un chiffre que le CV de référence ne donne pas : ne propose jamais un fait qu'il ne contient pas ; demande-le au candidat.`);
          case "invalid_edit":
            return refused(`La modification n° ${review.edit + 1} ne se lit pas : une formation ou une langue se coupe, se réordonne ou se met en avant, sans être reformulée ; un poste se reformule par son intitulé ou sa description.`);
          case "no_change":
            return refused("Ces modifications ne changent rien au CV de référence : rien n'a été proposé.");
        }
      }
      const { t } = createI18n(language);
      const change: ProposedChange = {
        target: { kind: "profile", id: profile.id, name: profile.name, href: routes.profileSection(profile.id, "cv-de-reference") },
        what: t("profilePage.sections.cv-de-reference"),
        before: t("coachProposals.masterCv.version", { version: profile.masterCv.version }),
        after: t("coachProposals.masterCv.changes", { count: review.changes.length }),
        value: {},
        fields: [],
        version: String(profile.masterCv.version),
        review: { changes: review.changes, edits: review.edits },
      };
      return { ok: true, data: change, pages: [routes.profileSection(profile.id, "cv-de-reference")] };
    },
    async apply(change, call): Promise<ApplyProposalResult> {
      if (!change.review) return NOT_FOUND;
      // The accepted changes are sent with « Enregistrer », never inferred (ADR-0006): none, nothing to save.
      const ids = new Set(change.review.changes.map((each) => each.id));
      const accepted = (call.accepted ?? []).filter((each) => ids.has(each));
      if (accepted.length === 0) return { ok: false, error: "invalid", errors: [{ field: "accepted", code: "required" }] };
      const profile = await activeProfile(sources, call.candidateId, change.target.id);
      if (!profile) return NOT_FOUND;
      const seen = Number(change.version);
      if (profile.masterCv.version !== seen) return { ok: false, error: "conflict" };
      const content = acceptedMasterCv(profile.masterCv.content, change.review.edits, accepted);
      const saved = await sources.profiles.saveMasterCv(call.candidateId, profile.id, { basedOnVersion: seen, content }, { origin: originOf(call) });
      if (!saved) return NOT_FOUND;
      if (!saved.ok) return "conflict" in saved ? { ok: false, error: "conflict" } : { ok: false, error: "invalid", errors: saved.errors };
      // Nothing changed: no new version, nothing to put back.
      if (saved.profile.masterCv.version === seen) return { ok: true };
      return { ok: true, undo: { profileId: profile.id, before: seen, version: saved.profile.masterCv.version } };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = undoSchema.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { profileId, before, version } = kept.data;
      const versions = await sources.profiles.masterCvVersions(candidateId, profileId);
      const content = versions?.find((each) => each.version === before)?.content;
      if (!content) return NOT_FOUND;
      // A Restore of the version before: a new version, the history kept; a newer version since is a conflict.
      const restored = await sources.profiles.saveMasterCv(candidateId, profileId, { basedOnVersion: version, content }, { restoredFrom: before });
      if (!restored) return NOT_FOUND;
      return restored.ok ? { ok: true } : { ok: false, error: "conflict" };
    },
  });
}

// ——— Archive and restore ———

function archiveAction(sources: ProfileActionSources, archive: boolean): CoachAction {
  const undoSchema = z.object({ profileId: z.string() });
  /** Archives or restores, `archived` the state it must be in: not, a conflict. */
  const turn = async (candidateId: string, profileId: string, from: boolean, language: "fr" | "en"): Promise<ApplyProposalResult> => {
    const profile = await sources.profiles.get(candidateId, profileId);
    if (!profile) return NOT_FOUND;
    if (profile.archived !== from) return { ok: false, error: "conflict" };
    const done = from ? await sources.profiles.restore(candidateId, profileId) : await sources.profiles.archive(candidateId, profileId);
    if (!done.ok) {
      if ("errors" in done) return { ok: false, error: "invalid", errors: done.errors };
      if (done.error === "not_found") return NOT_FOUND;
      // Restoring beyond the Plan Quota, the room it saw gone since (#773): the Upgrade prompt, as the card shows it without room.
      const prompt = await sources.profileUpgradePrompt(candidateId, language);
      return prompt ? { ok: false, error: "quota", prompt } : { ok: false, error: "conflict" };
    }
    return { ok: true, undo: { profileId } };
  };
  return defineCoachAction({
    name: archive ? PROFILE_ACTIONS.archive : PROFILE_ACTIONS.restore,
    description: archive
      ? "Propose d'archiver un profil actif du candidat : il garde son CV de référence et ses critères, mais sort du sélecteur de profils et ne compte plus dans son forfait. Jamais pour supprimer : un profil ne se supprime pas."
      : "Propose de restaurer un profil archivé du candidat, nommé par son id ou par son nom : il redevient actif et compte dans son forfait.",
    schema: archive
      ? z.object({ profileId: id.describe("L'id du profil actif à archiver.") })
      : z.object({ profileId: id.optional().describe("L'id du profil archivé à restaurer."), name: z.string().trim().min(1).max(120).optional().describe("Son nom, s'il n'a pas l'id.") }),
    group: "profile",
    kind: "propose",
    copiesText: false,
    async run(args, { candidateId, language }) {
      const { profileId, name } = args as { profileId?: string; name?: string };
      let profile: Profile | null = null;
      if (archive) profile = await activeProfile(sources, candidateId, profileId!);
      else {
        const archived = (await sources.profiles.list(candidateId)).filter((each) => each.archived);
        const found = archived.find((each) => each.id === profileId) ?? archived.filter((each) => name !== undefined && folded(each.name) === folded(name)).at(0);
        profile = found ? await sources.profiles.get(candidateId, found.id) : null;
        if (!profile?.archived) profile = null;
      }
      if (!profile) return NOT_FOUND;
      const { t } = createI18n(language);
      const status = (archived: boolean) => t(archived ? "profilePage.status.archived" : "profilePage.status.active");
      const prompt = archive ? null : await sources.profileUpgradePrompt(candidateId, language);
      const change: ProposedChange = {
        target: { kind: "profile", id: profile.id, name: profile.name, href: routes.profile(profile.id) },
        what: t("coachProposals.fields.profileStatus"),
        before: status(!archive),
        after: status(archive),
        value: {},
        fields: [],
        version: archive ? "active" : "archived",
        ...(archive ? {} : { quota: { label: t("coachProposals.quota.profile"), ...(prompt ? { prompt } : {}) } }),
      };
      return { ok: true, data: change, pages: [routes.profile(profile.id)] };
    },
    apply: (change, { candidateId, language }) => turn(candidateId, change.target.id, !archive, language ?? "fr"),
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = undoSchema.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      // Annuler an archive restores it: without room, a conflict (the Upgrade prompt is for a proposal still to apply).
      const done = await turn(candidateId, kept.data.profileId, archive, "fr");
      return done.ok ? { ok: true } : { ok: false, error: done.error === "not_found" ? "not_found" : "conflict" };
    },
  });
}

// ——— Coach Memory ———

function coachMemoryAction(sources: ProfileActionSources): CoachAction {
  const undoSchema = z.object({ itemId: z.string(), updatedAt: z.string() });
  const itemSchema = z.object({ kind: z.enum(COACH_MEMORY_KINDS), text: z.string() });
  return defineCoachAction({
    name: PROFILE_ACTIONS.coachMemory,
    description: `Propose de retenir dans la mémoire du coach un fait clé que le candidat a dit (un objectif, une contrainte, une décision), un seul par appel, en ${MAX_ITEM_LENGTH} caractères au plus, sans nom, e-mail, téléphone ni adresse. Le candidat le confirme ou l'ignore.`,
    schema: z.object({ kind: z.enum(COACH_MEMORY_KINDS), text: z.string().trim().min(1).max(MAX_ITEM_LENGTH) }),
    group: "profile",
    kind: "propose",
    copiesText: true,
    async run({ kind, text }, { candidateId, language }) {
      const items = await sources.coachMemory.list(candidateId);
      if (items.some((item) => sameFact(item.text) === sameFact(text))) return refused("La mémoire du coach retient déjà ce fait : ne le propose pas à nouveau.");
      if (items.length >= MAX_ITEMS) return refused(`La mémoire du coach est pleine (${MAX_ITEMS} éléments) : dis au candidat d'en supprimer un depuis « Mémoire du coach » pour en ajouter un autre.`);
      const { t } = createI18n(language);
      const kindLabel = (each: (typeof COACH_MEMORY_KINDS)[number]) => t(`coachMemory.kinds.${each}`);
      const change: ProposedChange = {
        // One card per fact: told apart by its words.
        target: { kind: "coach_memory", id: createHash("sha256").update(sameFact(text)).digest("hex").slice(0, 16), name: t("coachMemory.title"), href: "" },
        what: t("coachProposals.fields.coachMemory"),
        before: t("coachProposals.coachMemory.before"),
        after: `${kindLabel(kind)} : ${text}`,
        value: { kind, text },
        fields: [
          { name: "kind", label: t("coachMemory.kindLabel"), type: "select", options: COACH_MEMORY_KINDS.map((each) => ({ value: each, label: kindLabel(each) })) },
          { name: "text", label: t("coachMemory.textLabel"), type: "textarea" },
        ],
        version: "absent",
      };
      return { ok: true, data: change };
    },
    async apply(change, { candidateId }): Promise<ApplyProposalResult> {
      const item = itemSchema.safeParse(change.value);
      if (!item.success) return { ok: false, error: "invalid", errors: [{ field: "kind", code: "invalid" }] };
      const before = await sources.coachMemory.list(candidateId);
      const known = before.some((each) => sameFact(each.text) === sameFact(item.data.text));
      const confirmed = await sources.coachMemory.confirm(candidateId, item.data);
      if (!confirmed.ok) return { ok: false, error: "invalid", errors: [{ field: "text", code: confirmed.error === "full" ? "too_long" : "invalid" }] };
      // Already remembered: nothing added, nothing to forget.
      if (known) return { ok: true };
      return { ok: true, undo: { itemId: confirmed.item.id, updatedAt: confirmed.item.updatedAt.toISOString() } };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = undoSchema.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const item = (await sources.coachMemory.list(candidateId)).find((each) => each.id === kept.data.itemId);
      if (!item) return NOT_FOUND;
      // Edited since in « Mémoire du coach »: it is the Candidate's own words now.
      if (item.updatedAt.toISOString() !== kept.data.updatedAt) return { ok: false, error: "conflict" };
      return (await sources.coachMemory.delete(candidateId, item.id)) ? { ok: true } : NOT_FOUND;
    },
  });
}

/** The « Profil » group's Coach Actions, over `sources`. */
export function profileCoachActions(sources: ProfileActionSources): CoachAction[] {
  return [searchCriteriaAction(sources), masterCvAction(sources), archiveAction(sources, true), archiveAction(sources, false), coachMemoryAction(sources)];
}
