import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { Field, Textarea } from "@/design/Field";
import { getServerT } from "@/i18n/server";
import { getCoachEnrolments } from "./server";
const ID = "enrolmentId",
  DECISION = "decision",
  REASON = "reason",
  APPROVE = "approve",
  REFUSE = "refuse";
async function decide(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  if (!coachSpaceV2On()) notFound();
  const id = String(form.get(ID));
  const enrolments = getCoachEnrolments();
  const result = await getBackOffice().record(
    administrator,
    (within) => enrolments.decide(id, form.get(DECISION), form.get(REASON), within),
    (result) =>
      result.ok && result.changed
        ? {
            section: "human_coaches",
            target: id,
            action: "updated",
            before: { state: "pending" },
            after: { state: result.enrolment.state, humanCoachId: result.enrolment.humanCoachId, associationId: result.enrolment.associationId },
          }
        : null,
  );
  if (result.ok) await enrolments.deliverNotices();
  redirect(result.ok ? "/admin/coachs" : "/admin/coachs?error=enrolment");
}
export async function EnrolmentsAdmin({ canWrite }: { canWrite: boolean }) {
  if (!coachSpaceV2On()) return null;
  const [t, records] = await Promise.all([getServerT(), getCoachEnrolments().queue()]);
  return (
    <section className="section-block stack">
      <h2>{t("coachEnrolment.adminTitle")}</h2>
      {records.length ? (
        records.map((record) => (
          <article className="stack" key={record.id}>
            <h3>{record.legalName}</h3>
            <p>
              {record.contactName} · {record.email}
            </p>
            <p>
              {record.status} · {record.siret}
            </p>
            <p>
              {record.specialties.join(", ")} · {record.languages.join(", ")}
            </p>
            <p>{record.presentation}</p>
            <p>{t(`coachEnrolment.state.${record.state}`)}</p>
            <Link href={`/admin/coachs/demandes/${record.id}`}>{t("coachEnrolment.adminProof")}</Link>
            {record.reason ? (
              <p>
                {t("coachEnrolment.reason")} : {record.reason}
              </p>
            ) : null}
            {record.state === "pending" && canWrite ? (
              <>
                <form action={decide}>
                  <input name={ID} type="hidden" value={record.id} />
                  <button className="button" type="submit" name={DECISION} value={APPROVE}>
                    {t("coachEnrolment.approve")}
                  </button>
                </form>
                <form className="stack" action={decide}>
                  <input name={ID} type="hidden" value={record.id} />
                  <Field label={t("coachEnrolment.reason")}>
                    <Textarea name={REASON} minLength={3} maxLength={2000} required />
                  </Field>
                  <button className="button" type="submit" name={DECISION} value={REFUSE}>
                    {t("coachEnrolment.refuse")}
                  </button>
                </form>
              </>
            ) : null}
          </article>
        ))
      ) : (
        <p>{t("coachEnrolment.adminEmpty")}</p>
      )}
    </section>
  );
}
