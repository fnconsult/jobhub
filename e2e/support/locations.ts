import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

// The Search Criteria's Locations (#235): the places as chips, then one input suggesting more.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

type Scope = Page | Locator;

/** The Locations field ("Lieux"), in `scope`. */
export const locationsField = (scope: Scope) => scope.getByRole("group", { name: fr.cvReview.locations, exact: true });
/** The places listed, each chip's name. */
export const placeNames = (scope: Scope) => locationsField(scope).getByRole("listitem").locator("> span");
/** The input that adds a place ("Ajouter un lieu"). */
export const placeInput = (scope: Scope) => scope.getByRole("combobox", { name: fr.cvReview.placeInput, exact: true });
/** The suggestions shown under the input. */
export const placeOptions = (scope: Scope) => scope.getByRole("listbox").getByRole("option");
/** The "Retirer {{place}}" button of one chip. */
export const removePlace = (scope: Scope, place: string) => scope.getByRole("button", { name: fr.cvReview.removeLocation.replace("{{place}}", place), exact: true });

/** Adds `place` as typed, with Enter (before any suggestion). */
export async function typePlace(scope: Scope, place: string) {
  await placeInput(scope).fill(place);
  await placeInput(scope).press("Enter");
}
