import { ExitPage, exitPageMetadata } from "@/components/ExitPage";

const SITE = "site";

export const generateMetadata = exitPageMetadata;

/** The Exit Page (« Vous quittez Jobbbox ») of the site: in the sidebar for a signed-in Candidate, under the public site's header otherwise. */
export default function SiteExitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ExitPage shell={SITE} searchParams={searchParams} />;
}
