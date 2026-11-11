import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachAssociations } from "@/coach-associations/server";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export default async function Page() {
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
      <main className="page stack">
        <h1>{t("association.title")}</h1>
        {associations.map((a) => (<Link key={a.id} href={`/espace-association/${a.id}/coachs`}>
            {a.name}
          </Link>))}
      </main>
    </PublicSite>);
}
