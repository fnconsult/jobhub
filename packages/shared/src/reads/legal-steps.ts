/**
 * What the Jobbbox app asks after sign-in (#689, ADR-0076): the same legal gates as the web app, on a native screen.
 * `GET /api/account/legal-steps` answers them; the app records each answer through the web's own routes.
 */
import * as z from "zod";

/**
 * A Legal Text Version as the app shows it: its id (its effective date), its permanent address on the web app, its
 * title, « En bref » and its numbered sections, each body the repo's own Markdown. `translation`: shown in English, so
 * the French text prevails.
 */
export const shownLegalTextSchema = z.object({
  version: z.iso.date(),
  url: z.string(),
  title: z.string(),
  translation: z.boolean(),
  inBrief: z.array(z.string()),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
});
export type ShownLegalTextRead = z.infer<typeof shownLegalTextSchema>;

/**
 * `GET /api/account/legal-steps` (`?lang=`: the app's language, the Candidate's Interface Language otherwise): the CGU
 * version to accept before anything else (ADR-0062; `POST /api/account/acceptances`), the privacy policy's change to
 * show once (the Privacy change notice, ADR-0072; `DELETE /api/privacy-change/:version`), and whether the EU AI
 * Consent is given (`PUT /api/account/eu-ai-consent`). Null when there is none.
 */
export const legalStepsResponseSchema = z.object({
  acceptance: shownLegalTextSchema.nullable(),
  privacyChange: shownLegalTextSchema.nullable(),
  euAiConsentGiven: z.boolean(),
});
export type LegalStepsResponse = z.infer<typeof legalStepsResponseSchema>;
