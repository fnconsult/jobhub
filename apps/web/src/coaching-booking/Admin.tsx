import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { getCoachingBooking, calTeamId, calBookingOn } from "./server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const COACH = "coachId",
  EVENT = "eventTypeId",
  HOST = "hostId",
  DURATION = "duration",
  DESTINATION = "/admin/coachs";
async function attach(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write"),
    coachId = String(form.get(COACH)),
    eventTypeId = Number(form.get(EVENT)),
    hostId = Number(form.get(HOST)),
    booking = getCoachingBooking();
  let saved = false;
  try {
    saved =
      (await getBackOffice().record(
        administrator,
        async (within) => {
          const before = await booking.configured(coachId, within);
          const changed = await booking.configure(coachId, calTeamId(), eventTypeId, hostId, within);
          return changed ? { before, after: await booking.configured(coachId, within) } : null;
        },
        (value) =>
          value
            ? {
                section: "human_coaches",
                target: coachId,
                action: "updated",
                before: value.before ? { ...value.before } : null,
                after: value.after ? { ...value.after } : null,
              }
            : null,
      )) !== null;
  } catch {
    saved = false;
  }
  redirect(`${DESTINATION}?booking=${saved ? "saved" : "failed"}`);
}
async function create(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write"),
    coachId = String(form.get(COACH)),
    booking = getCoachingBooking();
  let outcome = "failed";
  try {
    const coach = (await getHumanCoaches().list({ includePending: true })).find((c) => c.id === coachId);
    if (coach) {
      const event = await booking.create(coachId, {
        teamId: calTeamId(),
        hostId: Number(form.get(HOST)),
        durationMinutes: Number(form.get(DURATION)),
        title: coach.name,
      });
      if (event) {
        const attached = await getBackOffice().record(
          administrator,
          async (within) => ((await booking.configure(coachId, event.teamId, event.id, event.hostId, within)) ? event : null),
          (event) => (event ? { section: "human_coaches", target: coachId, action: "updated", before: null, after: { ...event } } : null),
        );
        outcome = attached ? "created" : "needs_review";
      }
    }
  } catch {
    outcome = "needs_review";
  }
  redirect(`${DESTINATION}?booking=${outcome}`);
}
export async function BookingAdmin({ canWrite, status }: { canWrite: boolean; status?: string | undefined }) {
  const t = await getServerT(),
    booking = getCoachingBooking(),
    coaches = await getHumanCoaches().list({ includePending: true });
  return (
    <section className="stack">
      <h2>{t("coachingBooking.adminTitle")}</h2>
      <p>{t("coachingBooking.adminIntro")}</p>
      {status ? (
        <Note tone={status === "saved" || status === "created" ? "success" : "danger"} role="status">
          {t(status === "saved" || status === "created" ? "coachingBooking.saved" : "coachingBooking.failed")}
        </Note>
      ) : null}
      {!(await calBookingOn()) ? <p>{t("coachingBooking.legalPending")}</p> : null}
      {coaches.map(async (coach) => {
        const event = await booking.configured(coach.id);
        return (
          <Card as={ARTICLE} headingLevel={3} title={coach.name} key={coach.id}>
            <div className="stack">
              {coach.bookingUrl.includes("cal.eu") ? <p>{t("coachingBooking.reviewLegacy")}</p> : null}
              {event ? <p>{t("coachingBooking.configured", { id: event.id, host: event.hostId, minutes: event.durationMinutes })}</p> : null}
              {canWrite ? (
                <>
                  <form action={attach} className="stack">
                    <input type="hidden" name={COACH} value={coach.id} />
                    <Field label={t("coachingBooking.eventId")}>
                      <TextInput name={EVENT} type="number" min={1} required />
                    </Field>
                    <Field label={t("coachingBooking.hostId")}>
                      <TextInput name={HOST} type="number" min={1} required />
                    </Field>
                    <button className={buttonClass({ size: "sm" })} type="submit">
                      {t("coachingBooking.attach")}
                    </button>
                  </form>
                  <form action={create} className="stack">
                    <input type="hidden" name={COACH} value={coach.id} />
                    <Field label={t("coachingBooking.hostId")}>
                      <TextInput name={HOST} type="number" min={1} required />
                    </Field>
                    <Field label={t("coachingBooking.duration")}>
                      <TextInput name={DURATION} type="number" min={1} max={480} required />
                    </Field>
                    <button className={buttonClass({ size: "sm" })} type="submit">
                      {t("coachingBooking.create")}
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
