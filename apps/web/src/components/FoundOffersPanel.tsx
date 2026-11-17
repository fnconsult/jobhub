import Link from "next/link";
import type { FicheLink } from "@/components/Fiche";
import { FoundOffers } from "@/components/OfferBox";
import { offerBoxResponse } from "@/candidate-reads";
import { readOfferBox } from "@/offer-box/server";

/**
 * A Job Search's or a Job Digest's « Offres trouvées » in the side panel, as Recherches d'offres shows its Job Offers: the
 * Candidate's Offer box entries for the Job Offers it found (`results`, by the address ending in their id), with their
 * actions, without the box's header and source chips. A Job Offer found with no entry (none was recorded for it) stays a
 * link under them. Null when the Offer box cannot be read: the panel then lists the Job Offers as links, as before.
 */
export async function FoundOffersPanel({ candidateId, of, results }: { candidateId: string; of: { kind: "job_search" | "job_digest"; id: string }; results: readonly FicheLink[] }) {
  const box = await readOfferBox(candidateId).catch((error: unknown) => {
    console.error("[found-offers] could not read the Offer box", error);
    return null;
  });
  if (!box) return null;
  const found = new Map(results.map((result) => [result.href.slice(result.href.lastIndexOf("/") + 1), result]));
  const contents = { ...box, entries: box.entries.filter((entry) => found.has(entry.jobOffer.id)) };
  const shown = new Set(contents.entries.map((entry) => entry.jobOffer.id));
  const rest = [...found].filter(([jobOfferId]) => !shown.has(jobOfferId)).map(([, result]) => result);
  return (
    <FoundOffers
      box={offerBoxResponse(contents)}
      of={of}
      rest={
        rest.length > 0 ? (
          <ul className="fiche-links">
            {rest.map((result) => (
              <li key={result.href}>
                <Link href={result.href} scroll={false}>
                  <span className="fiche-link-label">{result.label}</span>
                  {result.detail ? <span className="fiche-link-detail">{result.detail}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null
      }
    />
  );
}
