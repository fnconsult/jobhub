import { redirect } from "next/navigation";
import { requireBackOffice, getBackOffice } from "@/admin/server";
import { Field, Textarea } from "@/design/Field";
import { getServerT } from "@/i18n/server";
import { getCoachPages } from "./server";
import { PublicCoachProfile } from "./PublicCoachProfile";
const ID = "versionId", DECISION = "decision", REASON = "reason", APPROVE = "approve", REFUSE = "refuse";
async function decide(form: FormData) {
    "use server";
    const { administrator } = await requireBackOffice("humanCoaches", "write");
    const pages = getCoachPages(), id = String(form.get(ID));
    const result = await getBackOffice().record(administrator, (within) => pages.decide(id, form.get(DECISION), form.get(REASON), within), (result) => result.ok && result.changed
        ? {
            section: "human_coaches",
            target: result.version.coachId,
            action: "updated",
            before: { profileState: "pending" },
            after: { profileState: result.version.state, versionId: id, revision: result.version.revision },
        }
        : null);
    if (result.ok)
        await pages.deliverNotices();
    redirect(result.ok ? "/admin/coachs" : "/admin/coachs?error=profile");
}
export async function CoachPagesAdmin({ canWrite }: {
    canWrite: boolean;
}) {
    const records = (await getCoachPages().queue()).map((p) => ({ ...p, photoUrl: p.photo ? `data:image/webp;base64,${p.photo.toString("base64")}` : null })), t = await getServerT();
    return (<section className="section-block stack">
      <h2>{t("coachPage.adminTitle")}</h2>
      {records.length ? (records.map((p) => (<article className="coach-space-card stack" key={p.id}>
            <h3>{p.coachName}</h3>
            <p>{p.email}</p>
            <PublicCoachProfile name={p.coachName} page={{ ...p.content, photoUrl: p.photoUrl }}/>
            {canWrite ? (<>
                <form action={decide}>
                  <input type="hidden" name={ID} value={p.id}/>
                  <button className="button" type="submit" name={DECISION} value={APPROVE}>
                    {t("coachPage.approve")}
                  </button>
                </form>
                <form className="stack" action={decide}>
                  <input type="hidden" name={ID} value={p.id}/>
                  <Field label={t("coachPage.reason")}>
                    <Textarea name={REASON} required minLength={3} maxLength={2000}/>
                  </Field>
                  <button className="button" type="submit" name={DECISION} value={REFUSE}>
                    {t("coachPage.refuse")}
                  </button>
                </form>
              </>) : null}
          </article>))) : (<p>{t("coachPage.adminEmpty")}</p>)}
    </section>);
}
