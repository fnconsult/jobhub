import { ApplicationFirstSectionPage, type Params } from "./sections";

/** An Application's page itself: its first Section (ADR-0024; below 64rem, the list of its Sections). */
export default function ApplicationPage({ params }: Params) {
  return <ApplicationFirstSectionPage params={params} />;
}
