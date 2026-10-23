import { createProvenanceRecorder, type AiLayer } from "@jobhub/ai";
import type { JobOffer } from "@jobhub/shared";
import type { FieldsFromText, TextReading } from "./index";

/**
 * A Job Offer's text read by `read` on `ai` (its summary, sector and the fields it lacks), with that reading's
 * Provenance: the model that read it, on the site of the offer's page. What `read` throws is thrown.
 */
export async function recordedReading(ai: AiLayer, jobOffer: Pick<JobOffer, "source">, read: (ai: AiLayer) => Promise<FieldsFromText>): Promise<TextReading> {
  const reading = createProvenanceRecorder(ai);
  if (jobOffer.source.url) reading.site(jobOffer.source.url);
  const fields = await read(reading.ai);
  return { ...fields, provenance: reading.provenance() };
}
