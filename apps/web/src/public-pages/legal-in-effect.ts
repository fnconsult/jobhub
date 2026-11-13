import { isPublicLegalTextId, legalTextRegistry, legalTextVersionInEffect, type LegalTextVersionRecord } from "@jobhub/help";

/** What `GET /api/legal/<texte>/in-effect` answers: the version in effect, or none yet (`version: null`). */
export type LegalTextInEffect = { version: string; url: string } | { version: null };

/**
 * The version of a Legal Text in effect `on` that day (YYYY-MM-DD, in France), as the extension reads it to name the
 * CGU on the Guest's box (#550): its id (the effective date) and permanent URL. Null for a text that does not exist.
 * Nothing else of the registry is served: the fingerprint and the change stay the web app's.
 */
export function legalTextInEffect(text: string, on: string, registry: readonly LegalTextVersionRecord[] = legalTextRegistry()): LegalTextInEffect | null {
  if (!isPublicLegalTextId(text)) return null;
  const record = legalTextVersionInEffect(text, on, registry);
  return record ? { version: record.version, url: record.url } : { version: null };
}
