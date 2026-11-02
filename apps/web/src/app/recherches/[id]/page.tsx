import type { Metadata } from "next";
import { getServerT } from "@/i18n/server";
import { requireOwnJobSearch } from "@/job-searches/server";
import type { Params } from "./job-search-page";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobSearch } = await requireOwnJobSearch((await params).id);
  return { title: `${t("jobSearch.title", { profile: jobSearch.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Search: the page is the Job Search's conversation (layout.tsx, #605, ADR-0070), its outcome in its Fiche;
 * nothing is open in the Work Pane at its own address.
 */
export default function JobSearchPage() {
  return null;
}
