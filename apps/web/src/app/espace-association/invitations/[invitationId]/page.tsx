import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachAssociations } from "@/coach-associations/server";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
const F = { id: "invitationId", token: "token" };
async function accept(form: FormData) {
  "use server";
  if (!coachSpaceV2On()) notFound();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  const result = await getCoachAssociations().accept(person, String(form.get(F.id)), form.get(F.token));
  if (!result.ok) notFound();
  redirect(result.role === "manager" ? "/espace-association" : "/espace-coach");
}
export default async function Page({ params, searchParams }: { params: Promise<{ invitationId: string }>; searchParams: Promise<{ token?: string }> }) {
  if (!coachSpaceV2On()) notFound();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  const { invitationId } = await params,
    { token } = await searchParams,
    record = await getCoachAssociations().invitation(person, invitationId, token);
  if (!record) notFound();
  const t = await getServerT();
  return (
    <PublicSite>
      <main className="page stack">
        <h1>{t("association.invitationTitle", { name: record.associationName })}</h1>
        <p>{t(record.role === "coach" ? "association.joinCoachHint" : "association.joinMemberHint")}</p>
        <p>
          {record.name} · {record.email}
        </p>
        <form action={accept}>
          <input type="hidden" name={F.id} value={invitationId} />
          <input type="hidden" name={F.token} value={token} />
          <button className="button" type="submit">
            {t("association.acceptInvitation")}
          </button>
        </form>
      </main>
    </PublicSite>
  );
}
