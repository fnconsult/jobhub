import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { BACK_OFFICE_ROLES, isBackOfficeRole } from "@/admin/access";
import { getAdministrators, requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox, Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "administrators";

const ERRORS = ["unknown_account", "unverified_account", "no_role", "own_super_admin", "permanent", "last_super_admin", "forbidden"] as const;
type ErrorCode = (typeof ERRORS)[number];
const RESET_ERRORS = ["unknown_account", "forbidden"] as const;
const isResetError = (value: string | undefined): value is (typeof RESET_ERRORS)[number] => RESET_ERRORS.includes(value as (typeof RESET_ERRORS)[number]);

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("roles");
  const t = await getServerT();
  return { title: `${t("admin.administrators.title")} · ${t("admin.title")}`, robots: { index: false } };
}

async function grantRoles(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("roles", "write");
  const roles = form.getAll("roles").filter(isBackOfficeRole);
  const granted = await getAdministrators().grant(administrator, String(form.get("email") ?? ""), roles);
  if (!granted.ok) redirect(`${routes.adminAdministrators}?error=${granted.error}`);
  redirect(`${routes.adminAdministrators}?granted=${roles.join(",")}`);
}

/** Resets an account's Two-step verification (#665): super-admins alone, a box ticked to confirm. */
async function resetTwoStepVerification(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("roles", "write");
  if (form.get("confirm") !== "on") redirect(`${routes.adminAdministrators}?resetRefused=1#reset-two-step`);
  const reset = await getAdministrators().resetTwoStepVerification(administrator, String(form.get("email") ?? ""));
  if (!reset.ok) redirect(`${routes.adminAdministrators}?resetError=${reset.error}#reset-two-step`);
  redirect(`${routes.adminAdministrators}?reset=1#reset-two-step`);
}

async function revokeRole(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("roles", "write");
  const revoked = await getAdministrators().revoke(administrator, String(form.get("candidateId")), form.get("role"));
  if (!revoked.ok) redirect(`${routes.adminAdministrators}?error=${revoked.error}`);
  redirect(`${routes.adminAdministrators}?revoked=1`);
}

/**
 * Super-admins see every Administrator, their Back Office Roles and whether they have Two-step verification, grant
 * roles to an existing account by email, and revoke them; and reset an account's Two-step verification (#665).
 */
export default async function AdministratorsPage({ searchParams }: { searchParams: Promise<{ granted?: string; revoked?: string; error?: string; reset?: string; resetRefused?: string; resetError?: string }> }) {
  const { administrator: me, access } = await requireBackOffice("roles");
  const t = await getServerT();
  const { granted, revoked, error, reset, resetRefused, resetError } = await searchParams;
  const administrators = await getAdministrators().list();
  const roleName = (role: (typeof BACK_OFFICE_ROLES)[number]) => t(`admin.roles.${role}`);
  const isError = (value: string | undefined): value is ErrorCode => ERRORS.includes(value as ErrorCode);
  // The notice names the roles granted from their keys only: nothing typed in the address bar is shown.
  const grantedRoles = BACK_OFFICE_ROLES.filter((role) => (granted ?? "").split(",").includes(role));

  return (
    <BackOfficeLayout access={access} title={t("admin.administrators.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.administrators.title")} />
        {grantedRoles.length > 0 ? (
          <Note tone="success" role="status">
            {t("admin.administrators.granted", { roles: grantedRoles.map(roleName).join(", ") })}
          </Note>
        ) : null}
        {revoked ? (
          <Note tone="success" role="status">
            {t("admin.administrators.revoked")}
          </Note>
        ) : null}
        {isError(error) ? (
          <Note tone="danger" role="alert">
            {t(`admin.administrators.errors.${error}`)}
          </Note>
        ) : null}

        <Table
          label={t("admin.administrators.caption")}
          columns={[
            { header: t("admin.administrators.email"), rowHeader: true, cell: (administrator) => administrator.email },
            {
              header: t("admin.administrators.roles"),
              cell: (administrator) => (
                <ul className="section-list">
                  {administrator.roles.map((role) => {
                    // An ADMIN_EMAILS member's super-admin role, and one's own, cannot be revoked: no button.
                    const permanent = role === "super-admin" && administrator.permanent;
                    const own = role === "super-admin" && administrator.candidateId === me.id;
                    return (
                      <li key={role} className="section-actions">
                        <span>
                          {roleName(role)}
                          {permanent ? (
                            <>
                              {" "}
                              <strong title={t("admin.administrators.permanentHelp")}>({t("admin.administrators.permanent")})</strong>
                            </>
                          ) : null}
                        </span>
                        {permanent || own ? null : (
                          <form action={revokeRole}>
                            <input type="hidden" name="candidateId" value={administrator.candidateId} />
                            <input type="hidden" name="role" value={role} />
                            <button className={buttonClass({ size: "sm" })} type="submit">
                              {t("admin.administrators.revoke", { role: roleName(role), email: administrator.email })}
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ),
            },
            {
              header: t("admin.administrators.twoStep"),
              cell: (administrator) =>
                administrator.twoStepVerification ? (
                  t("admin.administrators.twoStepOn")
                ) : (
                  <Pill tone="warn">{t("admin.administrators.twoStepNone")}</Pill>
                ),
            },
          ]}
          rows={administrators}
          rowKey={(administrator) => administrator.candidateId}
        />
        {administrators.some((administrator) => administrator.permanent) ? <p className="section-meta">{t("admin.administrators.permanentHelp")}</p> : null}
        {administrators.some((administrator) => !administrator.twoStepVerification) ? <p className="section-meta">{t("admin.administrators.twoStepNoneHelp")}</p> : null}

        <form action={grantRoles}>
          <Card title={t("admin.administrators.grantTitle")}>
            <div className="section-form">
              <Field label={t("admin.administrators.grantEmail")} hint={t("admin.administrators.grantEmailHelp")}>
                <TextInput name="email" type="email" required autoComplete="off" />
              </Field>
              <fieldset>
                <legend>{t("admin.administrators.grantRoles")}</legend>
                {BACK_OFFICE_ROLES.map((role) => (
                  <Checkbox key={role} name="roles" value={role} label={roleName(role)} hint={t(`admin.administrators.roleHelp.${role}`)} />
                ))}
              </fieldset>
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("admin.administrators.grant")}
              </button>
            </div>
          </Card>
        </form>

        <form action={resetTwoStepVerification} aria-labelledby="reset-two-step">
          <Card title={<span id="reset-two-step">{t("admin.administrators.reset.title")}</span>}>
            <div className="section-form">
              <p>{t("admin.administrators.reset.intro")}</p>
              {reset ? (
                <Note tone="success" role="status">
                  {t("admin.administrators.reset.done")}
                </Note>
              ) : null}
              {resetRefused || isResetError(resetError) ? (
                <Note tone="danger" role="alert">
                  {isResetError(resetError) ? t(`admin.administrators.reset.errors.${resetError}`) : t("admin.administrators.reset.refused")}
                </Note>
              ) : null}
              <Field label={t("admin.administrators.reset.email")}>
                <TextInput name="email" type="email" required autoComplete="off" />
              </Field>
              <Checkbox name="confirm" required label={t("admin.administrators.reset.confirm")} />
              <button className={buttonClass({ variant: "danger" })} type="submit">
                {t("admin.administrators.reset.submit")}
              </button>
            </div>
          </Card>
        </form>
      </div>
    </BackOfficeLayout>
  );
}
