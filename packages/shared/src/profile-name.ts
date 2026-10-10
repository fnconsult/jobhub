/**
 * Profile name limits, shared by the web app and the extension (both make Profiles).
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
