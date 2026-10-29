import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Textarea, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Table } from "@/design/Table";
import { getHumanCoaches } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../section.css";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("humanCoaches");
  const t = await getServerT();
  return { title: `${t("admin.humanCoaches.title")} · ${t("admin.title")}`, robots: { index: false } };
}

async function addCoach(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  const added = await getBackOffice().addHumanCoach(administrator, {
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
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  await getBackOffice().retireHumanCoach(administrator, String(form.get("coachId")));
  redirect(`${routes.adminHumanCoaches}?retired=1`);
}

/** Administrators add Human Coaches, with their Cal.com booking link, and retire them. */
export default async function HumanCoachesAdminPage({ searchParams }: { searchParams: Promise<{ added?: string; error?: string; retired?: string }> }) {
  const { access, canWrite } = await requireBackOffice("humanCoaches");
  const t = await getServerT();
  const { added, error, retired } = await searchParams;
  const coaches = await getHumanCoaches().list();

  return (
    <BackOfficeLayout access={access} title={t("admin.humanCoaches.title")}>
      <div className="section-page">
        <PageIntro t={t} page="humanCoaches" subject={t("admin.humanCoaches.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {added ? (
          <Note tone="success" role="status">
            {t("admin.humanCoaches.added", { name: added })}
          </Note>
        ) : null}
        {retired ? (
          <Note tone="success" role="status">
            {t("admin.humanCoaches.retired")}
          </Note>
        ) : null}
        {error ? (
          <Note tone="danger" role="alert">
            {t(error === "email_taken" ? "admin.humanCoaches.emailTaken" : "admin.humanCoaches.invalid")}
          </Note>
        ) : null}

        <section className="section-block" aria-labelledby="coaches-title">
          <h2 id="coaches-title">{t("admin.humanCoaches.listTitle")}</h2>
          {coaches.length === 0 ? (
            <p>{t("admin.humanCoaches.none")}</p>
          ) : (
            <Table
              label={t("admin.humanCoaches.listTitle")}
              columns={[
                { key: "name", header: t("admin.humanCoaches.name"), rowHeader: true, cell: (coach) => coach.name },
                { key: "email", header: t("admin.humanCoaches.email"), cell: (coach) => coach.email },
                {
                  key: "booking",
                  header: t("admin.humanCoaches.bookingUrl"),
                  cell: (coach) => (
                    <a href={coach.bookingUrl} rel="noopener noreferrer" target="_blank">
                      {coach.bookingUrl}
                    </a>
                  ),
                },
                { key: "bio", header: t("admin.humanCoaches.bio"), cell: (coach) => coach.bio || "—" },
                {
                  key: "retire",
                  header: <span className="visually-hidden">{t("admin.rowActions")}</span>,
                  cell: (coach) => (
                    <BackOfficeForm canWrite={canWrite} action={retireCoach}>
                      <input type="hidden" name="coachId" value={coach.id} />
                      <button className={buttonClass({ size: "sm" })} type="submit" disabled={!canWrite}>
                        {t("admin.humanCoaches.retire", { name: coach.name })}
                      </button>
                    </BackOfficeForm>
                  ),
                },
              ]}
              rows={coaches}
              rowKey={(coach) => coach.id}
            />
          )}
        </section>

        <BackOfficeForm canWrite={canWrite} action={addCoach}>
          <Card title={t("admin.humanCoaches.addTitle")}>
            {/* Read-only for roles that may not change Human Coaches: the fields show, disabled, with nothing to send. */}
            <fieldset className="section-form" disabled={!canWrite}>
              <Field label={t("admin.humanCoaches.name")}>
                <TextInput name="name" required autoComplete="off" />
              </Field>
              <Field label={t("admin.humanCoaches.email")}>
                <TextInput name="email" type="email" required autoComplete="off" />
              </Field>
              <Field label={t("admin.humanCoaches.bookingUrl")} hint={t("admin.humanCoaches.bookingUrlHelp")}>
                <TextInput name="bookingUrl" type="url" required />
              </Field>
              <Field label={t("admin.humanCoaches.bio")}>
                <Textarea name="bio" />
              </Field>
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("admin.humanCoaches.add")}
              </button>
            </fieldset>
          </Card>
        </BackOfficeForm>
      </div>
    </BackOfficeLayout>
  );
}
