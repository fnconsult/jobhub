import { designTokens, type TextSizeSetting } from "./tokens";

export const TEXT_SIZE_SETTINGS = Object.keys(designTokens.textSize) as TextSizeSetting[];
export const TEXT_SIZE_STORAGE_KEY = "jobbbox.textSize";

function isTextSizeSetting(value: unknown): value is TextSizeSetting {
  return typeof value === "string" && (TEXT_SIZE_SETTINGS as string[]).includes(value);
}

/**
 * Turns a stored text-size setting (possibly missing or stale) into the root
 * font size to apply. Every type size is in rem, so this scales the whole UI.
 */
export function resolveTextSize(stored: string | null | undefined): { setting: TextSizeSetting; rootPx: number } {
  const setting = isTextSizeSetting(stored) ? stored : "standard";
  return { setting, rootPx: designTokens.fontSize.body * designTokens.textSize[setting] };
}
