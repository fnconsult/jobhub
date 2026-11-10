import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { InviteForm, PendingInvitations } from "@/coach-associations/InviteForm";
import { getServerT } from "@/i18n/server";
const PAGE = "membres";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invited?: string; error?: string }> }) {
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT();
  const [members, invitations] = await Promise.all([associations.members(person, id), associations.invitations(person, id)]);
  const query = await searchParams;
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.invited ? <p role="status">{t("association.invited")}</p> : null}
      {query.error ? <p role="alert">{t("association.invalid")}</p> : null}
      <p>{t("association.memberRights")}</p>
      <InviteForm associationId={id} role="manager" />
      <PendingInvitations associationId={id} invitations={(invitations ?? []).filter((x) => x.role === "manager")} />
      {members?.map((member) => (
        <article className="coach-space-card" key={member.id}>
          <h2>{member.name}</h2>
          <p>{member.email}</p>
        </article>
      ))}
    </AssociationLayout>
  );
}
