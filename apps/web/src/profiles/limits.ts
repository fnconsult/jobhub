/**
 * Profile name limits (kept apart from the module so the browser bundle can use them; the limit itself is in @jobhub/shared).
 * A Profile is named after its target role when created, so the target role obeys the same limit.
 */
import { fitProfileName, PROFILE_NAME_MAX_LENGTH } from "@jobhub/shared";

export { fitProfileName, PROFILE_NAME_MAX_LENGTH };

/**
 * The name suggested for a copy of the Profile `name`, e.g. "DAF (copie)": `format` adds the
 * (translated) suffix, and `name` is shortened first so that the result fits the limit.
 */
export function copyName(name: string, format: (name: string) => string): string {
  const room = PROFILE_NAME_MAX_LENGTH - format("").length;
  return format(fitProfileName(name, Math.max(room, 1)));
}
