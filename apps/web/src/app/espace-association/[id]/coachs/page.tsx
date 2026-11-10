import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { InviteForm, PendingInvitations } from "@/coach-associations/InviteForm";
import { retireCoach } from "@/coach-associations/actions";
import { getServerT } from "@/i18n/server";
const F = { associationId: "associationId", coachId: "coachId" };
const PAGE = "coachs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; invited?: string; retired?: string }>;
}) {
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT();
  const [coaches, invitations, query] = await Promise.all([associations.coaches(person, id), associations.invitations(person, id), searchParams]);
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.error ? <p role="alert">{t("association.invalid")}</p> : null}
      {query.invited ? <p role="status">{t("association.invited")}</p> : null}
      {query.retired ? <p role="status">{t("association.coachRetired")}</p> : null}
      <p>{t("association.noCandidateAccess")}</p>
      <InviteForm associationId={id} role="coach" />
      <PendingInvitations associationId={id} invitations={(invitations ?? []).filter((x) => x.role === "coach")} />
      {!coaches?.length ? (
        <p>{t("association.noCoaches")}</p>
      ) : (
        coaches.map((coach) => (
          <article className="coach-space-card stack" key={coach.id}>
            <h2>{coach.name}</h2>
            <p>{coach.email}</p>
            <p>{coach.bio}</p>
            {coach.retiredAt ? (
              <p>{t("association.retired")}</p>
            ) : (
              <>
                <p>{t(coach.contractPending ? "association.contractPending" : "association.active")}</p>
                <p>{t("association.retireWarning")}</p>
                <form action={retireCoach}>
                  <input type="hidden" name={F.associationId} value={id} />
                  <input type="hidden" name={F.coachId} value={coach.id} />
                  <button className="button" type="submit">
                    {t("association.retireCoach", { name: coach.name })}
                  </button>
                </form>
              </>
            )}
          </article>
        ))
      )}
    </AssociationLayout>
  );
}
