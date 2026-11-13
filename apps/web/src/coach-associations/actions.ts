"use server";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/i18n/server";
import { requireAssociation } from "./server";
export async function invite(form: FormData) {
  const id = String(form.get("associationId")),
    { person, associations } = await requireAssociation(id);
  const role = form.get("role");
  const result = await associations.invite(person, id, { name: form.get("name"), email: form.get("email"), role, locale: await getRequestLocale() });
  if (result.ok) await associations.deliverInvitations();
  redirect(`/espace-association/${id}/${role === "manager" ? "membres" : "coachs"}${result.ok ? "?invited=1" : "?error=invalid"}`);
}
export async function retireCoach(form: FormData) {
  const id = String(form.get("associationId")),
    { person, associations } = await requireAssociation(id);
  const ok = await associations.retireCoach(person, id, String(form.get("coachId")));
  redirect(`/espace-association/${id}/coachs${ok ? "?retired=1" : "?error=invalid"}`);
}
export async function cancelInvitation(form: FormData) {
  const id = String(form.get("associationId")),
    { person, associations } = await requireAssociation(id);
  await associations.cancelInvitation(person, id, String(form.get("invitationId")));
  redirect(`/espace-association/${id}/${form.get("role") === "manager" ? "membres" : "coachs"}`);
}
export async function saveOffer(form: FormData) {
  const id = String(form.get("associationId")),
    { person, associations } = await requireAssociation(id);
  const ok = await associations.saveOffer(person, id, {
    coachId: form.get("coachId"),
    seller: form.get("seller"),
    durationMinutes: Number(form.get("durationMinutes")),
    amount: form.get("amount") === "" ? null : Math.round(Number(form.get("amount")) * 100),
  });
  redirect(`/espace-association/${id}/offres${ok ? "?saved=1" : "?error=invalid"}`);
}
