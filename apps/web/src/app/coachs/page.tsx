import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getHumanCoaches } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("humanCoaches.title")} · ${t("app.name")}` };
}

/** What the Coach Access form asks for. */
const ACCESS = { grant: "grant", revoke: "revoke" } as const;

async function changeCoachAccess(form: FormData) {
  "use server";
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const coachId = String(form.get("coachId"));
  if (form.get("access") === ACCESS.grant) await getHumanCoaches().grantAccess(candidate.id, coachId);
  else await getHumanCoaches().revokeAccess(candidate.id, coachId);
  redirect(routes.coaching);
}

/**
 * The Candidate's Human Coaches: book (and pay for) a Coaching Session, pick its time on
 * the Human Coach's Cal.com page once paid, and grant or revoke Coach Access.
 */
export default async function HumanCoachesPage({ searchParams }: { searchParams: Promise<{ session?: string; error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const { session, error } = await searchParams;
  const coaching = getHumanCoaches();
  const [coaches, granted, sessions, price] = await Promise.all([
    coaching.list(),
    coaching.accessGranted(candidate.id),
    coaching.sessions(candidate.id),
    getBilling()
      .coachingSessionPrice(candidate.id)
      .catch((cause: unknown) => {
        console.error("[coaching] Coaching Session Price unavailable", cause);
        return null;
      }),
  ]);
  const money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });

  return (
    <main className="page">
      <WorkspaceHeader candidateId={candidate.id} />
      <h1>{t("humanCoaches.title")}</h1>
      <p className="lead">{t("humanCoaches.intro")}</p>
      {session === "paid" ? (
        <p className="notice" role="status">
          {t(sessions.length > 0 ? "humanCoaches.paid" : "humanCoaches.paidPending")}
        </p>
      ) : null}
      {error ? (
        <p className="notice" role="alert">
          {t(error === "unavailable" ? "humanCoaches.unavailable" : "humanCoaches.error")}
        </p>
      ) : null}

      {sessions.length > 0 ? (
        <section className="stack" aria-labelledby="sessions-title">
          <h2 id="sessions-title">{t("humanCoaches.sessionsTitle")}</h2>
          <ul className="stack">
            {sessions.map((paid) => (
              <li key={paid.id} className="stack">
                <p>{t("humanCoaches.sessionPaidOn", { name: paid.coach.name, date: date.format(paid.paidAt) })}</p>
                <p>
                  <a className="button button-primary" href={paid.coach.bookingUrl} rel="noopener noreferrer" target="_blank">
                    {t("humanCoaches.pickSlot", { name: paid.coach.name })}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="coaches-title">
        <h2 id="coaches-title">{t("humanCoaches.listTitle")}</h2>
        <p>{t("humanCoaches.accessIntro")}</p>
        {price === null ? (
          <p>{t("humanCoaches.unavailable")}</p>
        ) : price.amount < price.regularAmount ? (
          <p>{t("humanCoaches.premiumPrice", { price: money(price.amount, price.currency), regular: money(price.regularAmount, price.currency) })}</p>
        ) : (
          <p>
            {t("humanCoaches.price", { price: money(price.amount, price.currency) })} {t("humanCoaches.premiumHint")}
          </p>
        )}
        {coaches.length === 0 ? <p>{t("humanCoaches.none")}</p> : null}
        <ul className="stack">
          {coaches.map((coach) => {
            const hasAccess = granted.includes(coach.id);
            return (
              <li key={coach.id} className="stack">
                <h3>{coach.name}</h3>
                {coach.bio ? <p>{coach.bio}</p> : null}
                {price !== null ? (
                  <form method="post" action="/api/coaching/checkout">
                    <input type="hidden" name="coachId" value={coach.id} />
                    <button className="button button-primary" type="submit">
                      {t("humanCoaches.book", { name: coach.name })}
                    </button>
                  </form>
                ) : null}
                <p>{t(hasAccess ? "humanCoaches.accessGranted" : "humanCoaches.accessNotGranted", { name: coach.name })}</p>
                <form action={changeCoachAccess}>
                  <input type="hidden" name="coachId" value={coach.id} />
                  <input type="hidden" name="access" value={hasAccess ? ACCESS.revoke : ACCESS.grant} />
                  <button className="button" type="submit">
                    {t(hasAccess ? "humanCoaches.revoke" : "humanCoaches.grant", { name: coach.name })}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

    </main>
  );
}
