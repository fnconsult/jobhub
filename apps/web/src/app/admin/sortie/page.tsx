import { ExitPage, exitPageMetadata } from "@/components/ExitPage";

const BACK_OFFICE = "backOffice";

export const generateMetadata = exitPageMetadata;

/** The Exit Page of the Back Office: in the Back Office for an Administrator, as on the site for anyone else, so the Back Office stays unseen. */
export default function BackOfficeExitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ExitPage shell={BACK_OFFICE} searchParams={searchParams} />;
}
