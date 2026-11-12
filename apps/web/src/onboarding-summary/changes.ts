/**
 * The changes « Modifier » found in a rewritten onboarding summary (#1005, ADR-0106), as the card shows them for the
 * Candidate to validate: « J'ai compris : + CDD, − Lyon, + Paris ».
 *
 *   criteriaChanges(before, after)              each change, in the order the card tells them
 *   changeWords(change, { t, language, industries })   one change in words: « + CDD », « Poste recherché : Comptable »
 *
 * Pure, and safe in the browser.
 */
import { locationKey, referenceLabels, type IndustryReference, type SearchCriteria } from "@jobhub/shared";

/** The criteria a list change is made in: an item added (`+`) or taken out (`-`). */
type ListCriterion = "contractTypes" | "locations" | "remoteWorkOptions" | "sectors" | "subsectors" | "domains";

/** One change of the Search Criteria: the target role or the minimum salary set, an item added to or removed from a list. */
export type CriteriaChange =
  | { criterion: "targetRole"; sign: "="; value: string }
  | { criterion: "minSalary"; sign: "="; value: number }
  | { criterion: "minSalary"; sign: "-" }
  | { criterion: ListCriterion; sign: "+" | "-"; value: string };

/** How a list's items are compared: places without case nor accents, codes as they are. */
const keyOf = (criterion: ListCriterion, value: string) => (criterion === "locations" ? locationKey(value) : value);

/**
 * What changed from `before` to `after`: the target role, the contract types, the places, remote work, the minimum
 * salary, then the Sectors and Domains; in each list, what is taken out before what is added, each in its list's order.
 */
export function criteriaChanges(before: Partial<SearchCriteria>, after: Partial<SearchCriteria>): CriteriaChange[] {
  const changes: CriteriaChange[] = [];
  const role = after.targetRole?.trim() ?? "";
  if (role && role !== (before.targetRole?.trim() ?? "")) changes.push({ criterion: "targetRole", sign: "=", value: role });
  const list = (criterion: ListCriterion) => {
    const was = (before[criterion] ?? []) as readonly string[];
    const is = (after[criterion] ?? []) as readonly string[];
    const wasKeys = new Set(was.map((value) => keyOf(criterion, value)));
    const isKeys = new Set(is.map((value) => keyOf(criterion, value)));
    for (const value of was) if (!isKeys.has(keyOf(criterion, value))) changes.push({ criterion, sign: "-", value });
    for (const value of is) if (!wasKeys.has(keyOf(criterion, value))) changes.push({ criterion, sign: "+", value });
  };
  list("contractTypes");
  list("locations");
  list("remoteWorkOptions");
  if (after.minSalary !== before.minSalary) {
    changes.push(after.minSalary === undefined ? { criterion: "minSalary", sign: "-" } : { criterion: "minSalary", sign: "=", value: after.minSalary });
  }
  list("sectors");
  list("subsectors");
  list("domains");
  return changes;
}

/** The criteria the changes touch, each once. */
export function changedCriteria(changes: readonly CriteriaChange[]): CriteriaChange["criterion"][] {
  return [...new Set(changes.map((change) => change.criterion))];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** « + », and the true minus sign « − ». */
const SIGN = { "+": "+", "-": "−" } as const;

/**
 * One change in words, in the interface's language: « + CDD », « − Lyon », « Poste recherché : Comptable », « Salaire
 * minimum : 60 000 € »; a Sector or Domain by its label (`industries`), its code when the reference data does not name it.
 */
export function changeWords(change: CriteriaChange, { t, language, industries }: { t: Translate; language: "fr" | "en"; industries: IndustryReference }): string {
  switch (change.criterion) {
    case "targetRole":
      return t("onboardingSummary.changes.targetRole", { value: change.value });
    case "minSalary":
      return change.sign === "-"
        ? t("onboardingSummary.changes.noSalary")
        : t("onboardingSummary.changes.salary", {
            value: new Intl.NumberFormat(language === "en" ? "en-GB" : "fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(change.value),
          });
    case "contractTypes":
      return `${SIGN[change.sign]} ${t(`cvReview.contractTypes.${change.value}`)}`;
    case "remoteWorkOptions":
      return `${SIGN[change.sign]} ${t(`cvReview.remoteWorkOptions.${change.value}`)}`;
    case "locations":
      return `${SIGN[change.sign]} ${change.value}`;
    case "sectors":
    case "subsectors":
    case "domains":
      return `${SIGN[change.sign]} ${referenceLabels([change.value], industries[change.criterion], language)[0] ?? change.value}`;
  }
}
