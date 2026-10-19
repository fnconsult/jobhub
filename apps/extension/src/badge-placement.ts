/**
 * Where the "Analyser cette offre" badge sits. On a job site's own page, at
 * the bottom right of the window. In an iframe (a gestmax.fr posting on the
 * employer's site, #187), at the top right of the frame, where the posting
 * starts: the host page may size the iframe to its whole content, so the
 * frame's "window" is the posting's full height and its bottom is out of sight.
 * Fixed to the frame's top suits both cases: an auto-sized iframe's top is the
 * posting's title, and a scrolling iframe keeps the badge in view.
 */
export type BadgePlacement = { top?: number; bottom?: number; right: number };

export function badgePlacement(inTopFrame: boolean, spacing: number): BadgePlacement {
  return inTopFrame ? { right: spacing, bottom: spacing } : { right: spacing, top: spacing };
}

/** The placement as CSS declarations for the badge's host (position: fixed). */
export function placementCss(placement: BadgePlacement): string {
  return Object.entries(placement)
    .map(([side, px]) => `${side}: ${px}px;`)
    .join(" ");
}
