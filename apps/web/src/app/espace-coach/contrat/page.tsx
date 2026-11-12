import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { headers } from "next/headers";
import { fromJobbboxApp } from "@/api-version";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { legalText, parisDay } from "@jobhub/help";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachContracts, getCoachContractWritten } from "@/coach-contracts/server";
import { ContractText } from "@/coach-contracts/ContractText";
import { PublicSite } from "@/design/PublicSite";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";
import { getRequestLocale, getServerT } from "@/i18n/server";
const ASSOCIATION_CONTRACT_PAGE = "contrat";
const KIND = "kind", ID = "id", VERSION = "version", SHA = "sha256", AGREED = "agreed", YES = "yes";
async function accept(form: FormData) {
    "use server";
    requireCoachSpaceV2();
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    if (form.get(AGREED) !== YES)
        redirect("/espace-coach/contrat?error=required");
    const kind = form.get(KIND);
    const accepted = await getCoachContracts().accept(person, kind, String(form.get(ID)), form.get(VERSION), form.get(SHA), fromJobbboxApp(await headers()) ? "mobile" : "web");
    if (!accepted)
        redirect("/espace-coach/contrat?error=stale");
    redirect(kind === "association" ? "/espace-association" : "/espace-coach/aujourdhui");
}
export default async function Page({ searchParams }: {
    searchParams: Promise<{
        error?: string;
        association?: string;
    }>;
}) {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const contracts = getCoachContracts(), actors = await contracts.actors(person);
    if (!actors.length)
        notFound();
    const t = await getServerT(), locale = await getRequestLocale(), on = parisDay();
    const records = await Promise.all(actors.map((actor) => contracts.state(person, actor.kind, actor.id)));
    const shown = legalText("contrat-coach", locale, { on }, getCoachContractWritten(locale));
    const { error, association: requestedAssociation } = await searchParams;
    const inCoachSpace = records.some((record) => record?.actor.kind === "coach" && record.accepted);
    const associationActor = records.find((record) => record?.actor.kind === "association" && record.accepted && (!requestedAssociation || record.actor.id === requestedAssociation))?.actor;
    const inBusinessSpace = inCoachSpace || !!associationActor;
    const content = (<>
      {!inBusinessSpace ? <h1 className="ds-site__title">{t("coachSpaceV2.pages.contrat")}</h1> : null}
      {error ? <Note tone="danger" role="alert">{t("coachContract.stale")}</Note> : null}
      {shown ? <ContractText shown={shown}/> : <p>{t("coachEnrolment.awaitingContract")}</p>}
      {records.map((record) => record ? (<Card title={record.actor.name} key={`${record.actor.kind}:${record.actor.id}`}>
            <div className="stack">
            {record.current && !record.accepted ? (<form className="stack" action={accept}>
                <input type="hidden" name={KIND} value={record.actor.kind}/>
                <input type="hidden" name={ID} value={record.actor.id}/>
                <input type="hidden" name={VERSION} value={record.current.version}/>
                <input type="hidden" name={SHA} value={record.current.sha256}/>
                <Checkbox name={AGREED} value={YES} required label={t("coachContract.agree", { version: record.current.version })}/>
                <button className={buttonClass({ variant: "primary" })} type="submit">
                  {t("coachContract.accept")}
                </button>
              </form>) : record.accepted ? (<p>{t("coachContract.upToDate")}</p>) : null}
            {record.history.length ? (<>
                <h3>{t("coachContract.history")}</h3>
                <ul>
                  {record.history.map((entry) => (<li key={entry.version}>
                      <Link href={entry.url}>
                        {t("coachContract.accepted", {
                        version: entry.version,
                        date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(entry.acceptedAt),
                    })}
                      </Link>
                    </li>))}
                </ul>
              </>) : null}
            </div>
          </Card>) : null)}
    </>);
    return inCoachSpace ? (<CoachSpaceShell>{content}</CoachSpaceShell>) : associationActor ? (<AssociationLayout association={associationActor} page={ASSOCIATION_CONTRACT_PAGE}>
      {content}
    </AssociationLayout>) : (<PublicSite>
      <main id="main" className="ds-site__page stack">{content}</main>
    </PublicSite>);
}
