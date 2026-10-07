/**
 * Profile name limits (kept apart from the module so the browser bundle can use them).
 * A Profile is named after its target role when created, so the target role obeys the same limit.
 */
export const PROFILE_NAME_MAX_LENGTH = 120;

/** `name`, trimmed and, if too long, shortened to the limit at a word boundary when there is one. */
export function fitProfileName(name: string, maxLength = PROFILE_NAME_MAX_LENGTH): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : trimmed.slice(0, maxLength)).trimEnd();
}

/**
 * The name suggested for a copy of the Profile `name`, e.g. "DAF (copie)": `format` adds the
 * (translated) suffix, and `name` is shortened first so that the result fits the limit.
 */
export function copyName(name: string, format: (name: string) => string): string {
  const room = PROFILE_NAME_MAX_LENGTH - format("").length;
  return format(fitProfileName(name, Math.max(room, 1)));
}
