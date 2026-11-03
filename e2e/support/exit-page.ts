// The Exit Page: a link out of Jobbbox leads to « Vous quittez Jobbbox » in the shell of the page it is on, which then
// takes the person to the site. What a spec expects of such a link's `href` and `rel`.

/** The Exit Page of each shell, as `apps/web/src/external-links.ts` has them. */
const EXIT_PATHS = { site: "/sortie", backOffice: "/admin/sortie", coachSpace: "/espace-coach/sortie" } as const;

/** The `href` of a link to `url` on a page of `shell`. */
export function exitHref(url: string, shell: keyof typeof EXIT_PATHS = "site"): string {
  return `${EXIT_PATHS[shell]}?url=${encodeURIComponent(url)}`;
}

/** Its `rel`: it keeps the referrer (a page of Jobbbox), which lets the Exit Page go on by itself. */
export const EXIT_LINK_REL = "noopener nofollow";
