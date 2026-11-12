import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachAssociations } from "@/coach-associations/server";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export default async function Page() {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): a 404.
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const associations = await getCoachAssociations().managed(person);
    if (!associations.length)
        notFound();
    if (associations.length === 1)
        redirect(`/espace-association/${associations[0]!.id}/coachs`);
    const t = await getServerT();
    return (<PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("association.title")}</h1>
        <ul className="stack">
          {associations.map((a) => (<li key={a.id}>
              <Link href={`/espace-association/${a.id}/coachs`}>{a.name}</Link>
            </li>))}
        </ul>
      </main>
    </PublicSite>);
}
