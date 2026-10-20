import { getExternalApiLog } from "@/ai-usage/server";
import { createGeoApiPlaces, type PlaceSuggestions } from "./geo-api";

let instance: PlaceSuggestions | undefined;

/** The app's place suggestions (#235): geo.api.gouv.fr, each call recorded, its answers kept by this server a short while. */
export function getPlaceSuggestions(): PlaceSuggestions {
  instance ??= createGeoApiPlaces({ externalApis: getExternalApiLog() });
  return instance;
}
