/**
 * « Pour bien commencer » (#1069): what the help reads of the Candidate's account to choose what it presents, on the web
 * and in the Jobbbox app (`gettingStarted` in `@jobhub/help/coach-help` makes the choice).
 */
import * as z from "zod";

/**
 * `GET /api/account/getting-started`: the account as « Pour bien commencer » reads it (when it was created, whether an
 * ATS Score exists for one of its CVs, whether it has a Capture from the extension, whether the extension is on the
 * Chrome Web Store); `account` null once the account's first 14 days are over, when there is nothing to show.
 */
export const gettingStartedResponseSchema = z.object({
  account: z
    .object({
      createdAt: z.iso.datetime(),
      atsScore: z.boolean(),
      extensionCapture: z.boolean(),
      extensionPublished: z.boolean(),
    })
    .nullable(),
});
export type GettingStartedResponse = z.infer<typeof gettingStartedResponseSchema>;
