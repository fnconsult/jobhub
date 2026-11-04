/**
 * The sign-in email's code (#686, ADR-0076): 6 digits beside its link, for a Candidate who reads the email on one device
 * and signs in on another (the app on their phone, the web on a computer). Better Auth's email OTP plugin keeps it, and
 * signs in with it at `/sign-in/email-otp`; it is issued here, by the magic link's email, never sent alone.
 *
 *  - valid as long as the link (`minutes`), used once, 5 tries: the 6th is refused, the right code included, and a
 *    new email has to be asked (a new email replaces the code with another);
 *  - stored hashed, as the link's token; the code itself reaches the email alone, never a log;
 *  - using the code spends the link, and the link the code (`afterSignIn`): one email, one sign-in.
 *
 * A session the code signs in is the magic link's (its `signInMethod`), the second step (ADR-0075) included.
 */
import type { GenericEndpointContext } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Pool } from "pg";

/** The endpoint that signs in with the email's code. */
export const SIGN_IN_CODE_PATH = "/sign-in/email-otp";
/** The endpoint that signs in with the email's link. */
const SIGN_IN_LINK_PATH = "/magic-link/verify";
/** How many wrong codes a code takes before it no longer works. */
export const SIGN_IN_CODE_TRIES = 5;

/** The email OTP plugin's kind of code that signs in; its row's identifier (Better Auth 1.7: `sign-in-otp-<email>`). */
const codeIdentifier = (email: string) => `sign-in-otp-${email.trim().toLowerCase()}`;

export function signInCodes({ minutes, database }: { minutes: number; database: Pick<Pool, "query"> }) {
  const plugin = emailOTP({
    otpLength: 6,
    expiresIn: minutes * 60,
    allowedAttempts: SIGN_IN_CODE_TRIES,
    storeOTP: "hashed",
    // The code is never emailed alone: the plugin's own sending endpoint is not served (index.ts).
    sendVerificationOTP: async () => {
      throw new Error("The sign-in code is emailed with its link");
    },
    // Its tries, a few people behind one address included, within Better Auth's limit per client address.
    rateLimit: { window: 60, max: 10 },
  });

  return {
    plugin,

    /** The code the sign-in email to `email` carries, replacing any code emailed before. `context`: the endpoint's. */
    async issue(email: string, context: GenericEndpointContext["context"]): Promise<string> {
      await context.internalAdapter.deleteVerificationByIdentifier(codeIdentifier(email));
      const code: unknown = await plugin.endpoints.createVerificationOTP({ context, body: { email, type: "sign-in" } } as never);
      if (typeof code !== "string") throw new Error("The sign-in code was not issued");
      return code;
    },

    /**
     * Better Auth's hook after a session is created: a sign-in by the email's link spends its code, and one by its code
     * spends every link emailed to that address and still pending.
     */
    async afterSession(session: { userId: string }, ctx: GenericEndpointContext | null): Promise<void> {
      const path = ctx?.path;
      const byLink = path?.startsWith(SIGN_IN_LINK_PATH);
      if (!ctx || (!byLink && path !== SIGN_IN_CODE_PATH)) return;
      const user = await ctx.context.internalAdapter.findUserById(session.userId);
      if (!user) return;
      if (byLink) return ctx.context.internalAdapter.deleteVerificationByIdentifier(codeIdentifier(user.email));
      // The magic link's rows (Better Auth 1.7): `magic-link:<hashed token>`, its value the JSON of its email as asked.
      await database.query(
        `DELETE FROM verification WHERE identifier LIKE 'magic-link:%' AND position(lower('"email":' || to_json($1::text)::text) in lower(value)) > 0`,
        [user.email],
      );
    },
  };
}

export type SignInCodes = ReturnType<typeof signInCodes>;
