import { redirect } from "next/navigation";
import { routes } from "@/routes";

/** Légal opens on its first Legal Text, the CGU. */
export default function LegalPage() {
  redirect(routes.legal());
}
