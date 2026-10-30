import { redirect } from "next/navigation";
import { routes } from "@/routes";

/** Légal (#470) opens on its first Legal Document. */
export default function LegalPage() {
  redirect(routes.legal());
}
