import { notFound } from "next/navigation";

/** An address under /admin that is no page: the Back Office's 404 (admin/not-found), not the public one (#542). */
export default function MissingBackOfficePage() {
  notFound();
}
