import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Pill } from "@/design/Pill";
import { Properties, Property } from "@/design/Properties";
import { getServerT } from "@/i18n/server";
import { getCoachEnrolments } from "./server";
import type { Enrolment } from "./index";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const CONTRACT_PATH = "/espace-coach/contrat";
const ID = "id", ACTION = "action", CONFIRM = "confirm", WITHDRAW = "withdraw";
/** An enrolment's state, in its tone. */
export const ENROLMENT_TONE = { awaiting_email: "warn", pending: "accent", approved: "success", refused: "danger" } as const satisfies Record<Enrolment["state"], string>;
async function act(form: FormData) {
    "use server";
    requireCoachSpaceV2();
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
    return (<Card as={ARTICLE} title={record.legalName} actions={<Pill tone={ENROLMENT_TONE[record.state]}>{t(`coachEnrolment.state.${record.state}`)}</Pill>}>
      <div className="stack">
      <Properties>
        <Property term={t("coachEnrolment.fields.contactName")}>{record.contactName}</Property>
        <Property term={t("coachEnrolment.fields.email")}>{record.email}</Property>
        <Property term={t("coachEnrolment.fields.status")}>{record.status}</Property>
        <Property term={t("coachEnrolment.fields.siret")}>{record.siret}</Property>
        <Property term={t("coachEnrolment.fields.specialties")}>{record.specialties.join(", ")}</Property>
        <Property term={t("coachEnrolment.fields.languages")}>{record.languages.join(", ")}</Property>
      </Properties>
      <p>{record.presentation}</p>
      <p>{record.proofName}</p>
      {record.reason ? (<p>
          {t("coachEnrolment.reason")} : {record.reason}
        </p>) : null}
      {record.state === "awaiting_email" ? (<form action={act}>
          <input type="hidden" name={ID} value={record.id}/>
          <button className={buttonClass({ variant: "primary" })} type="submit" name={ACTION} value={CONFIRM}>
            {t("coachEnrolment.confirm")}
          </button>
        </form>) : null}
      {record.state === "pending" || record.state === "awaiting_email" ? (<form action={act}>
          <input type="hidden" name={ID} value={record.id}/>
          <button className={buttonClass({ variant: "danger" })} type="submit" name={ACTION} value={WITHDRAW}>
            {t("coachEnrolment.withdraw")}
          </button>
        </form>) : null}
      {record.state === "approved" ? <Link href={CONTRACT_PATH}>{t("coachEnrolment.contract")}</Link> : null}
      </div>
    </Card>);
}
