import { errorPageMetadata, ShellErrorPage } from "@/components/ErrorPage";

export const generateMetadata = () => errorPageMetadata(403);

/** A page reserved for another role (#542, `forbidden()`): a Candidate on the coach space, for one. */
export default function Forbidden() {
  return <ShellErrorPage code={403} />;
}
