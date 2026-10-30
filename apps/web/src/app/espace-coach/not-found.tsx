import { errorPageMetadata, ShellErrorPage } from "@/components/ErrorPage";

const COACH_SPACE = "coachSpace";

export const generateMetadata = () => errorPageMetadata(404);

/** A coach space page not found (#542): under the coach space's header for a Human Coach, else as anywhere. */
export default function CoachSpaceNotFound() {
  return <ShellErrorPage code={404} shell={COACH_SPACE} />;
}
