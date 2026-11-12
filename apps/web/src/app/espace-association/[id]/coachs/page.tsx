import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { InviteForm, PendingInvitations } from "@/coach-associations/InviteForm";
import { retireCoach } from "@/coach-associations/actions";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Status } from "@/design/Pill";
import { getServerT } from "@/i18n/server";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const F = { associationId: "associationId", coachId: "coachId" };
const PAGE = "coachs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; invited?: string; retired?: string }>;
}) {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): a 404.
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT();
  const [coaches, invitations, query] = await Promise.all([associations.coaches(person, id), associations.invitations(person, id), searchParams]);
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.error ? (
        <Note tone="danger" role="alert">
          {t("association.invalid")}
        </Note>
      ) : null}
      {query.invited ? (
        <Note tone="success" role="status">
          {t("association.invited")}
        </Note>
      ) : null}
      {query.retired ? (
        <Note tone="success" role="status">
          {t("association.coachRetired")}
        </Note>
      ) : null}
      <p>{t("association.noCandidateAccess")}</p>
      <InviteForm associationId={id} role="coach" />
      <PendingInvitations associationId={id} invitations={(invitations ?? []).filter((x) => x.role === "coach")} />
      {!coaches?.length ? (
        <p>{t("association.noCoaches")}</p>
      ) : (
        coaches.map((coach) => (
          <Card as={ARTICLE} title={coach.name} key={coach.id}>
            <div className="stack">
              <p>{coach.email}</p>
              <p>{coach.bio}</p>
              {coach.retiredAt ? (
                <p>
                  <Status>{t("association.retired")}</Status>
                </p>
              ) : (
                <>
                  <p>
                    <Status tone={coach.contractPending ? "warn" : "success"}>{t(coach.contractPending ? "association.contractPending" : "association.active")}</Status>
                  </p>
                  <p>{t("association.retireWarning")}</p>
                  <form action={retireCoach}>
                    <input type="hidden" name={F.associationId} value={id} />
                    <input type="hidden" name={F.coachId} value={coach.id} />
                    <button className={buttonClass({ variant: "danger" })} type="submit">
                      {t("association.retireCoach", { name: coach.name })}
                    </button>
                  </form>
                </>
              )}
            </div>
          </Card>
        ))
      )}
    </AssociationLayout>
  );
}
