import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { InviteForm, PendingInvitations } from "@/coach-associations/InviteForm";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { getServerT } from "@/i18n/server";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const PAGE = "membres";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invited?: string; error?: string }> }) {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): a 404.
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT();
  const [members, invitations] = await Promise.all([associations.members(person, id), associations.invitations(person, id)]);
  const query = await searchParams;
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.invited ? (
        <Note tone="success" role="status">
          {t("association.invited")}
        </Note>
      ) : null}
      {query.error ? (
        <Note tone="danger" role="alert">
          {t("association.invalid")}
        </Note>
      ) : null}
      <p>{t("association.memberRights")}</p>
      <InviteForm associationId={id} role="manager" />
      <PendingInvitations associationId={id} invitations={(invitations ?? []).filter((x) => x.role === "manager")} />
      {members?.map((member) => (
        <Card as={ARTICLE} title={member.name} key={member.id}>
          <p>{member.email}</p>
        </Card>
      ))}
    </AssociationLayout>
  );
}
