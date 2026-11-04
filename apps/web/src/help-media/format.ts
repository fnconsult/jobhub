/**
 * What the browser needs of the Help Centre's videos (#568), without the Platform Settings' catalog (which reads the
 * AI layer, a server module): the anchor « Voir la vidéo » leads to, and a duration as people read it.
 */

/** The anchor of a Tutorial's video on its Help Centre page: where the Coach Panel's « Voir la vidéo » leads. */
export const VIDEO_ANCHOR = "video";

/** A video's duration as people read it: « 45 s », « 1 min 05 s »; the same in English. */
export function videoDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes === 0 ? `${rest} s` : `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

/** The duration as `<time datetime>` takes it: « PT1M5S ». */
export function isoDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `PT${minutes ? `${minutes}M` : ""}${total % 60 ? `${total % 60}S` : ""}`;
}
