/**
 * Who our mailers send as (MAIL_FROM), apart from the mailers: the Platform Settings catalogue checks it
 * without loading the emails and their translation catalogues (#472).
 */

/** An email address as a sender takes it: one address, no spaces, no list separators. */
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\].][^\s@<>()",;:\\[\]]*$/;

/**
 * Whether `from` names one sender our mailers can send as (MAIL_FROM): "hello@jobbbox.ai",
 * "Jobbbox <hello@jobbbox.ai>" or '"Jobbbox" <hello@jobbbox.ai>'. Never a list, never a line break
 * (no header slipped in after it).
 */
export function isSender(from: string): boolean {
  const value = from.trim();
  if (/[\r\n]/.test(value)) return false;
  const named = /^(?:"[^"\\]*"|[^"<>,;]*?)\s*<([^<>]*)>$/.exec(value);
  return ADDRESS.test(named ? named[1]! : value);
}

/** The sender outside production when MAIL_FROM is not set (production requires it): the code's default of MAIL_FROM. */
export const DEVELOPMENT_MAIL_FROM = "Jobbbox <bonjour@localhost>";
