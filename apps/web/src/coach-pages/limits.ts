/** The courtesy File upload check and authoritative image decoder share this bound (ADR-0068). */
export const COACH_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const COACH_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export const COACH_PHOTO_MAX_PIXELS = 20_000_000;
