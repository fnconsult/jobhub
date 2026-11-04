import { parisDay } from "@jobhub/help";
import type { Metadata } from "next";
import { connection } from "next/server";
import { RecipientListView } from "@/design/RecipientListView";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { publicMetadata } from "@/public-pages/indexing-server";
import { recipientListNow } from "@/recipient-list/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("recipientList.title")} · ${t("app.name")}`, ...(await publicMetadata("/legal/destinataires", ["fr", "en"])) };
}

/**
 * The Recipient list (ADR-0064, #338), « Destinataires des données »: Jobbbox's Hosts and each Tool switched on that
 * receives personal data, or queries drawn from it, read from the catalog at this request, with the day it last changed.
 * `/en/legal/destinataires` is the same page in English (proxy.ts).
 */
export default async function RecipientListPage() {
  // Generated from the Tool catalog and the Tools' state at each request (ADR-0064): never prerendered.
  await connection();
  const { recipients, changedAt } = await recipientListNow();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <RecipientListView recipients={recipients} changedOn={changedAt ? parisDay(changedAt) : null} />
      </main>
    </PublicSite>
  );
}
