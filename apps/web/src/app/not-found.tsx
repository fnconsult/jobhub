import { errorPageMetadata, ShellErrorPage } from "@/components/ErrorPage";

// Without this file Next serves its built-in English 404 with inline styles,
// bypassing the French catalogue and the design tokens.
export const generateMetadata = () => errorPageMetadata(404);

/** A page not found (#542): in the sidebar for a signed-in Candidate, under the public site's header otherwise. */
export default function NotFound() {
  return <ShellErrorPage code={404} />;
}
