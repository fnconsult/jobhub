import { errorPageMetadata, ShellErrorPage } from "@/components/ErrorPage";

const BACK_OFFICE = "backOffice";

export const generateMetadata = () => errorPageMetadata(404);

/**
 * A Back Office page not found (#542): in the Back Office for an Administrator; anyone else gets the public 404,
 * so the Back Office stays unseen (`requireBackOffice`).
 */
export default function BackOfficeNotFound() {
  return <ShellErrorPage code={404} shell={BACK_OFFICE} />;
}
