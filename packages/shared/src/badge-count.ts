/** The largest count a badge shows as it is; above it, « 99+ ». */
const BADGE_MAX = 99;

/**
 * A count as a badge shows it (#939): as it is up to 99, then « 99+ », so the badge keeps its width. The exact count
 * stays in the badge's accessible name: only what is drawn is capped.
 *
 *   badgeCount(9);    // "9"
 *   badgeCount(128);  // "99+"
 */
export const badgeCount = (count: number): string => (count > BADGE_MAX ? `${BADGE_MAX}+` : String(count));
