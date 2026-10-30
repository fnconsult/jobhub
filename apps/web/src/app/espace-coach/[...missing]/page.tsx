import { notFound } from "next/navigation";

/** An address under /espace-coach that is no page: the coach space's 404 (espace-coach/not-found), not the public one (#542). */
export default function MissingCoachSpacePage() {
  notFound();
}
