import { ExitPage, exitPageMetadata } from "@/components/ExitPage";

const COACH_SPACE = "coachSpace";

export const generateMetadata = exitPageMetadata;

/** The Exit Page of the coach space: under the coach space's header for a Human Coach, as on the site for anyone else. */
export default function CoachSpaceExitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ExitPage shell={COACH_SPACE} searchParams={searchParams} />;
}
