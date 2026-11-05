/**
 * The sign-in email's code (#686) as the web's sign-in page and the app's sign-in screen take it: 6 digits, typed or
 * filled in by the system (iOS `oneTimeCode`, the browser's `one-time-code`), refused with a reason the person can act on.
 */

/** How many digits the code has. */
export const SIGN_IN_CODE_LENGTH = 6;

/** The code as typed: its digits, the spaces or dashes a mail client or a person adds between them dropped. */
export function typedSignInCode(input: string): string {
  return input.replace(/\D/g, "");
}

/** The catalogue key of what to say when the web app refuses a code: its Better Auth error code (email OTP plugin). */
export type SignInCodeRefusal = "signIn.codeWrong" | "signIn.codeExpired" | "signIn.codeTooManyTries" | "signIn.error";

export function signInCodeRefusal(code: string | undefined): SignInCodeRefusal {
  if (code === "INVALID_OTP") return "signIn.codeWrong";
  if (code === "OTP_EXPIRED") return "signIn.codeExpired";
  if (code === "TOO_MANY_ATTEMPTS") return "signIn.codeTooManyTries";
  return "signIn.error";
}
