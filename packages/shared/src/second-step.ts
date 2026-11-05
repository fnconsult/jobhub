/**
 * The second step of a session pending it (ADR-0075), as the web app's endpoints answer it to the second step's page
 * and to the native app (#688), which takes it on the same endpoints, with the same limits.
 *
 *   GET  SECOND_STEP_ENDPOINT          → SecondStepRead: what the session has to do, and with what
 *   POST SECOND_STEP_ENDPOINT          { code }: an authenticator app's code or a backup code
 *   POST SECOND_STEP_PASSKEY_ENDPOINT  {}: the passkey challenge; then { response }: the passkey's answer
 */
import { z } from "zod";

/** Where the second step posts a code (the second step's page, Mon compte, the native app), and reads what to do. */
export const SECOND_STEP_ENDPOINT = "/api/two-step-verification/second-step";
/** Where the second step with a passkey asks its challenge and posts the answer (#664). */
export const SECOND_STEP_PASSKEY_ENDPOINT = `${SECOND_STEP_ENDPOINT}/passkey`;

/**
 * What a session has to do before anything else: its second step, with the account's passkeys if it has any (`passkey`)
 * and its authenticator app if it has one (`app`; a backup code works either way); or, for an account that must have
 * Two-step verification and has no factor yet (an Administrator, a Human Coach, #665), set it up first; or nothing.
 */
export const secondStepReadSchema = z.union([
  z.object({ step: z.literal("second_step"), passkey: z.boolean(), app: z.boolean() }),
  z.object({ step: z.literal("setup") }),
  z.object({ step: z.null() }),
]);
export type SecondStepRead = z.infer<typeof secondStepReadSchema>;
