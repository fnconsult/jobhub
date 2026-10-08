/** Comparing company names, shared by the register adapter and the dossier rules. */

/** Words that decorate a company's name without telling companies apart. "France" is not one: ACME and ACME FRANCE are two companies. */
const DECORATIONS = new Set(["sa", "sas", "sasu", "sarl", "eurl", "sca", "snc", "se", "groupe", "group"]);

/** A company name compared without case, accents, punctuation or legal-form words. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !DECORATIONS.has(word))
    .join(" ");
}

/** A SIREN (9 digits) or SIRET (14 digits, whose first 9 are the SIREN) typed as the employer. */
export function sirenIn(employer: string): string | null {
  const digits = employer.replace(/[\s.]/g, "");
  return /^\d{9}$/.test(digits) ? digits : /^\d{14}$/.test(digits) ? digits.slice(0, 9) : null;
}
