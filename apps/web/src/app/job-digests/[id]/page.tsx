import type { Metadata } from "next";
import { getServerT } from "@/i18n/server";
import { requireOwnJobDigest } from "@/job-digests/server";
import type { Params } from "./job-digest-page";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobDigest } = await requireOwnJobDigest((await params).id);
  return { title: `${t("jobDigest.page.title", { profile: jobDigest.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Digest, linked from its email: the page is the Job Digest's conversation (layout.tsx, #605, ADR-0070), its
 * Job Offers in its Fiche; nothing is open in the Work Pane at its own address.
 */
export default function JobDigestPage() {
  return null;
}
