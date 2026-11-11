import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { getServerT } from "@/i18n/server";
import { getCoachEnrolments } from "./server";
import type { Enrolment } from "./index";
const CONTRACT_PATH = "/espace-coach/contrat";
const ID = "id", ACTION = "action", CONFIRM = "confirm", WITHDRAW = "withdraw";
async function act(form: FormData) {
    "use server";
    const person = await getCurrentCandidate();
    if (!person)
        redirect("/connexion?suite=%2Fdevenir-coach%2Fmes-demandes");
    const id = String(form.get(ID));
    const enrolments = getCoachEnrolments();
    if (form.get(ACTION) === CONFIRM)
        await enrolments.confirm(person, id);
    else if (form.get(ACTION) === WITHDRAW)
        await enrolments.withdraw(person, id);
    redirect("/devenir-coach/mes-demandes");
}
export async function OwnEnrolment({ record }: {
    record: Enrolment;
}) {
    const t = await getServerT();
    return (<article className="coach-space-card stack">
      <h2>{record.legalName}</h2>
      <p>{t(`coachEnrolment.state.${record.state}`)}</p>
      <dl>
        <dt>{t("coachEnrolment.fields.contactName")}</dt>
        <dd>{record.contactName}</dd>
        <dt>{t("coachEnrolment.fields.email")}</dt>
        <dd>{record.email}</dd>
        <dt>{t("coachEnrolment.fields.status")}</dt>
        <dd>{record.status}</dd>
        <dt>{t("coachEnrolment.fields.siret")}</dt>
        <dd>{record.siret}</dd>
        <dt>{t("coachEnrolment.fields.specialties")}</dt>
        <dd>{record.specialties.join(", ")}</dd>
        <dt>{t("coachEnrolment.fields.languages")}</dt>
        <dd>{record.languages.join(", ")}</dd>
      </dl>
      <p>{record.presentation}</p>
      <p>{record.proofName}</p>
      {record.reason ? (<p>
          {t("coachEnrolment.reason")} : {record.reason}
        </p>) : null}
      {record.state === "awaiting_email" ? (<form action={act}>
          <input type="hidden" name={ID} value={record.id}/>
          <button className="button" type="submit" name={ACTION} value={CONFIRM}>
            {t("coachEnrolment.confirm")}
          </button>
        </form>) : null}
      {record.state === "pending" || record.state === "awaiting_email" ? (<form action={act}>
          <input type="hidden" name={ID} value={record.id}/>
          <button className="button" type="submit" name={ACTION} value={WITHDRAW}>
            {t("coachEnrolment.withdraw")}
          </button>
        </form>) : null}
      {record.state === "approved" ? <Link href={CONTRACT_PATH}>{t("coachEnrolment.contract")}</Link> : null}
    </article>);
}
