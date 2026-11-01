/**
 * What the Fiche of a Profile, a Job Search and a Job Digest lists (#605, ADR-0070): its Sections and its Results, each
 * at its own address, which opens it in the Work Pane beside the object's conversation. The object's card is drawn by
 * its page; these are the links under it.
 */
import type { MatchScore } from "@jobhub/shared";
import type { TFunction } from "i18next";
import type { FicheLink } from "@/components/Fiche";
import { matchScoreFigure, matchScoreInWords } from "@/components/job-search-words";
import { JOB_DIGEST_SECTIONS, JOB_SEARCH_SECTIONS, routes, type ProfileSection } from "@/routes";

/** A Fiche's links: its Sections in order, then its Results. */
export type FicheLinks = { sections: FicheLink[]; results: FicheLink[] };

/** One Job Offer found for a Profile, as the Fiche needs it: by a Job Search, or in a Job Digest. */
type FoundJobOffer = { jobOffer: { id: string; title: string; employer?: string | undefined }; matchScore: MatchScore };

/** Saved dates are said in Paris time, as everywhere a Candidate reads them. */
const TIME_ZONE = "Europe/Paris";
/** The Section a Profile's CV export is in. */
const DOWNLOAD: ProfileSection = "telecharger";

/**
 * A Profile's Fiche: its Sections (those it has, in order), and as Results the versions of its Master CV, newest first,
 * the current one said so, each opened read-only with a way to restore it; then its CV export, the current version
 * downloaded as PDF or Word.
 */
export function profileFicheLinks(
  profile: { id: string; sections: readonly ProfileSection[]; currentVersion: number; versions: readonly { version: number; savedAt: Date }[] },
  t: TFunction,
  locale: string,
): FicheLinks {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: TIME_ZONE });
  const versions = [...profile.versions].sort((a, b) => b.version - a.version);
  return {
    sections: profile.sections.map((section) => ({ href: routes.profileSection(profile.id, section), label: t(`profilePage.sections.${section}`) })),
    results: [
      ...versions.map(({ version, savedAt }) => {
        const saved = t("versions.savedAt", { date: date.format(savedAt) });
        return {
          href: routes.masterCvVersion(profile.id, version),
          label: t("versions.version", { version }),
          detail: version === profile.currentVersion ? `${t("versions.current")} · ${saved}` : saved,
        };
      }),
      { href: routes.profileSection(profile.id, DOWNLOAD), label: t("cvExport.title"), detail: t("profilePage.results.export", { version: profile.currentVersion }) },
    ],
  };
}

/** A Job Search's Fiche: the list of the Job Offers it found as its Section, and each of them as a Result, in the order given. */
export function jobSearchFicheLinks(jobSearch: { id: string; results: readonly FoundJobOffer[] }, t: TFunction): FicheLinks {
  return {
    sections: JOB_SEARCH_SECTIONS.map((section) => ({ href: routes.jobSearchSection(jobSearch.id, section), label: t("jobSearch.resultsLabel") })),
    results: jobOfferLinks(jobSearch.results, (jobOfferId) => routes.jobSearchOffer(jobSearch.id, jobOfferId), t),
  };
}

/** A Job Digest's Fiche: the list of its Job Offers and its Profile's Job Digest settings as Sections, each Job Offer as a Result. */
export function jobDigestFicheLinks(jobDigest: { id: string; results: readonly FoundJobOffer[] }, t: TFunction): FicheLinks {
  const labels = { offres: t("jobSearch.resultsLabel"), reglages: t("jobDigest.page.settings") };
  return {
    sections: JOB_DIGEST_SECTIONS.map((section) => ({ href: routes.jobDigestSection(jobDigest.id, section), label: labels[section] })),
    results: jobOfferLinks(jobDigest.results, (jobOfferId) => routes.jobDigestOffer(jobDigest.id, jobOfferId), t),
  };
}

/** Each Job Offer by its title, with its employer and its Match Score. */
function jobOfferLinks(results: readonly FoundJobOffer[], href: (jobOfferId: string) => string, t: TFunction): FicheLink[] {
  return results.map(({ jobOffer, matchScore }) => ({
    href: href(jobOffer.id),
    label: jobOffer.title,
    detail: [jobOffer.employer, t("fiche.matchScore", { score: matchScoreInWords(matchScoreFigure(matchScore), t) })].filter(Boolean).join(" · "),
  }));
}
