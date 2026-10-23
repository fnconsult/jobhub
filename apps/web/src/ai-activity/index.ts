/**
 * AI Activity's page loaders (CONTEXT.md, ADR-0034): what the « Cette page » pane reads of a Candidate page,
 * the page's elements each with its stored Provenance, one loader per page type.
 *
 *   await jobOfferPage(jobOffers, id)   `/offres/[id]`: the Job Offer, how it was found, read and summarized
 *   modelsInWords(element, t)            the models that served an element, named for people, or « modèle non enregistré »
 *
 * An element carries no internal id, cost, prompt or text: its kind and its Provenance alone. One whose
 * Provenance was not kept (made before, or not by an AI action) has none, counts in no total, and shows
 * « modèle non enregistré ».
 */
import { describeModel, type Provenance } from "@jobhub/shared";
import type { TFunction } from "i18next";
import type { JobOffers } from "../job-offers";

/** One element of a page, as the pane lists it under « Par élément ». */
export interface ActivityElement {
  kind: "job_offer";
  /** Null: « modèle non enregistré », out of the totals. */
  provenance: Provenance | null;
}

/** `/offres/[id]`: the Job Offer `id` (the page has found it), with how it was obtained and its summary written. */
export async function jobOfferPage(jobOffers: Pick<JobOffers, "provenance">, id: string): Promise<ActivityElement[]> {
  return [{ kind: "job_offer", provenance: await jobOffers.provenance(id) }];
}

/** The models that served the element, named for people, each once in the order they served; « modèle non enregistré » without a Provenance. */
export function modelsInWords(element: ActivityElement, t: TFunction): string[] {
  if (!element.provenance) return [t("aiActivity.modelNotRecorded")];
  const names = element.provenance.steps.flatMap((step) => (step.kind === "ai" && step.model ? [describeModel(step.model, step.provider).name] : []));
  return [...new Set(names)];
}
