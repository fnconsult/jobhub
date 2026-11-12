import Link from "next/link";
import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Textarea } from "@/design/Field";
import { Pill } from "@/design/Pill";
import { getServerT } from "@/i18n/server";
import { getCoachEnrolments } from "./server";
import { ENROLMENT_TONE } from "./OwnEnrolment";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const ID = "enrolmentId", DECISION = "decision", REASON = "reason", APPROVE = "approve", REFUSE = "refuse";
async function decide(form: FormData) {
    "use server";
    const { administrator } = await requireBackOffice("humanCoaches", "write");
    const id = String(form.get(ID));
    const enrolments = getCoachEnrolments();
    const result = await getBackOffice().record(administrator, (within) => enrolments.decide(id, form.get(DECISION), form.get(REASON), within), (result) => result.ok && result.changed
        ? {
            section: "human_coaches",
            target: id,
            action: "updated",
            before: { state: "pending" },
            after: { state: result.enrolment.state, humanCoachId: result.enrolment.humanCoachId, associationId: result.enrolment.associationId },
        }
        : null);
    if (result.ok)
        await enrolments.deliverNotices();
    redirect(result.ok ? "/admin/coachs" : "/admin/coachs?error=enrolment");
}
export async function EnrolmentsAdmin({ canWrite }: {
    canWrite: boolean;
}) {
    const [t, records] = await Promise.all([getServerT(), getCoachEnrolments().queue()]);
    return (<section className="section-block stack">
      <h2>{t("coachEnrolment.adminTitle")}</h2>
      {records.length ? (records.map((record) => (<Card as={ARTICLE} headingLevel={3} title={record.legalName} actions={<Pill tone={ENROLMENT_TONE[record.state]}>{t(`coachEnrolment.state.${record.state}`)}</Pill>} key={record.id}>
            <div className="stack">
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
            <Link href={`/admin/coachs/demandes/${record.id}`}>{t("coachEnrolment.adminProof")}</Link>
            {record.reason ? (<p>
                {t("coachEnrolment.reason")} : {record.reason}
              </p>) : null}
            {record.state === "pending" && canWrite ? (<>
                <form action={decide}>
                  <input name={ID} type="hidden" value={record.id}/>
                  <button className={buttonClass({ variant: "primary", size: "sm" })} type="submit" name={DECISION} value={APPROVE}>
                    {t("coachEnrolment.approve")}
                  </button>
                </form>
                <form className="stack" action={decide}>
                  <input name={ID} type="hidden" value={record.id}/>
                  <Field label={t("coachEnrolment.reason")}>
                    <Textarea name={REASON} minLength={3} maxLength={2000} required/>
                  </Field>
                  <button className={buttonClass({ variant: "danger", size: "sm" })} type="submit" name={DECISION} value={REFUSE}>
                    {t("coachEnrolment.refuse")}
                  </button>
                </form>
              </>) : null}
            </div>
          </Card>))) : (<p>{t("coachEnrolment.adminEmpty")}</p>)}
    </section>);
}
