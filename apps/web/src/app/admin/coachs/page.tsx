import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/admin/server";
import { BackOfficeHeader } from "@/components/BackOfficeHeader";
import { getHumanCoaches } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireAdministrator();
  const t = await getServerT();
  return { title: `${t("admin.humanCoaches.title")} · ${t("admin.title")}`, robots: { index: false } };
}

async function addCoach(form: FormData) {
  "use server";
  await requireAdministrator();
  const added = await getHumanCoaches().add({
    name: form.get("name"),
    email: form.get("email"),
    bookingUrl: form.get("bookingUrl"),
    bio: form.get("bio") ?? "",
  });
  if (!added.ok) redirect(`${routes.adminHumanCoaches}?error=${"error" in added ? "email_taken" : "invalid"}`);
  redirect(`${routes.adminHumanCoaches}?added=${encodeURIComponent(added.coach.name)}`);
}

async function retireCoach(form: FormData) {
  "use server";
  await requireAdministrator();
  await getHumanCoaches().retire(String(form.get("coachId")));
  redirect(`${routes.adminHumanCoaches}?retired=1`);
}

/** Administrators add Human Coaches, with their Cal.com booking link, and retire them. */
export default async function HumanCoachesAdminPage({ searchParams }: { searchParams: Promise<{ added?: string; error?: string; retired?: string }> }) {
  await requireAdministrator();
  const t = await getServerT();
  const { added, error, retired } = await searchParams;
  const coaches = await getHumanCoaches().list();

  return (
    <main className="page">
      <BackOfficeHeader />
      <p>
        <Link href={routes.admin}>{t("admin.back")}</Link>
      </p>
      <h1>{t("admin.humanCoaches.title")}</h1>
      <p className="lead">{t("admin.humanCoaches.intro")}</p>
      {added ? (
        <p className="notice" role="status">
          {t("admin.humanCoaches.added", { name: added })}
        </p>
      ) : null}
      {retired ? (
        <p className="notice" role="status">
          {t("admin.humanCoaches.retired")}
        </p>
      ) : null}
      {error ? (
        <p className="notice" role="alert">
          {t(error === "email_taken" ? "admin.humanCoaches.emailTaken" : "admin.humanCoaches.invalid")}
        </p>
      ) : null}

      <section className="stack" aria-labelledby="coaches-title">
        <h2 id="coaches-title">{t("admin.humanCoaches.listTitle")}</h2>
        {coaches.length === 0 ? <p>{t("admin.humanCoaches.none")}</p> : null}
        <ul className="stack">
          {coaches.map((coach) => (
            <li key={coach.id} className="stack">
              <p>
                <strong>{coach.name}</strong> · {coach.email} ·{" "}
                <a href={coach.bookingUrl} rel="noopener noreferrer" target="_blank">
                  {coach.bookingUrl}
                </a>
              </p>
              {coach.bio ? <p>{coach.bio}</p> : null}
              <form action={retireCoach}>
                <input type="hidden" name="coachId" value={coach.id} />
                <button className="button" type="submit">
                  {t("admin.humanCoaches.retire", { name: coach.name })}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <form className="stack quota-form" action={addCoach}>
        <fieldset>
          <legend>
            <h2>{t("admin.humanCoaches.addTitle")}</h2>
          </legend>
          <div className="stack">
            <label htmlFor="coach-name">{t("admin.humanCoaches.name")}</label>
            <input id="coach-name" className="input" name="name" required autoComplete="off" />
          </div>
          <div className="stack">
            <label htmlFor="coach-email">{t("admin.humanCoaches.email")}</label>
            <input id="coach-email" className="input" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="stack">
            <label htmlFor="coach-booking-url">{t("admin.humanCoaches.bookingUrl")}</label>
            <input id="coach-booking-url" className="input" name="bookingUrl" type="url" required aria-describedby="coach-booking-url-help" />
            <p id="coach-booking-url-help">{t("admin.humanCoaches.bookingUrlHelp")}</p>
          </div>
          <div className="stack">
            <label htmlFor="coach-bio">{t("admin.humanCoaches.bio")}</label>
            <textarea id="coach-bio" className="input" name="bio" rows={3} />
          </div>
          <button className="button button-primary" type="submit">
            {t("admin.humanCoaches.add")}
          </button>
        </fieldset>
      </form>
    </main>
  );
}
