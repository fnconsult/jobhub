import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BACK_OFFICE_ROLES, isBackOfficeRole } from "@/admin/access";
import { getAdministrators, requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

const ERRORS = ["unknown_account", "unverified_account", "no_role", "own_super_admin", "permanent", "last_super_admin", "forbidden"] as const;
type ErrorCode = (typeof ERRORS)[number];

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

async function revokeRole(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("roles", "write");
  const revoked = await getAdministrators().revoke(administrator, String(form.get("candidateId")), form.get("role"));
  if (!revoked.ok) redirect(`${routes.adminAdministrators}?error=${revoked.error}`);
  redirect(`${routes.adminAdministrators}?revoked=1`);
}

/** Super-admins see every Administrator and their Back Office Roles, grant roles to an existing account by email, and revoke them. */
export default async function AdministratorsPage({ searchParams }: { searchParams: Promise<{ granted?: string; revoked?: string; error?: string }> }) {
  const { administrator: me, access } = await requireBackOffice("roles");
  const t = await getServerT();
  const { granted, revoked, error } = await searchParams;
  const administrators = await getAdministrators().list();
  const roleName = (role: (typeof BACK_OFFICE_ROLES)[number]) => t(`admin.roles.${role}`);
  const isError = (value: string | undefined): value is ErrorCode => ERRORS.includes(value as ErrorCode);
  // The notice names the roles granted from their keys only: nothing typed in the address bar is shown.
  const grantedRoles = BACK_OFFICE_ROLES.filter((role) => (granted ?? "").split(",").includes(role));

  return (
    <BackOfficeLayout access={access}>
      <h1>{t("admin.administrators.title")}</h1>
      <p className="lead">{t("admin.administrators.intro")}</p>
      {grantedRoles.length > 0 ? (
        <p className="notice" role="status">
          {t("admin.administrators.granted", { roles: grantedRoles.map(roleName).join(", ") })}
        </p>
      ) : null}
      {revoked ? (
        <p className="notice" role="status">
          {t("admin.administrators.revoked")}
        </p>
      ) : null}
      {isError(error) ? (
        <p className="notice" role="alert">
          {t(`admin.administrators.errors.${error}`)}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="application-table">
          <caption>{t("admin.administrators.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.administrators.email")}</th>
              <th scope="col">{t("admin.administrators.roles")}</th>
            </tr>
          </thead>
          <tbody>
            {administrators.map((administrator) => (
              <tr key={administrator.candidateId}>
                <th scope="row">{administrator.email}</th>
                <td>
                  <ul className="administrator-roles">
                    {administrator.roles.map((role) => {
                      // An ADMIN_EMAILS member's super-admin role, and one's own, cannot be revoked: no button.
                      const permanent = role === "super-admin" && administrator.permanent;
                      const own = role === "super-admin" && administrator.candidateId === me.id;
                      return (
                        <li key={role}>
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
                              <button className="button" type="submit">
                                {t("admin.administrators.revoke", { role: roleName(role), email: administrator.email })}
                              </button>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {administrators.some((administrator) => administrator.permanent) ? <p>{t("admin.administrators.permanentHelp")}</p> : null}

      <form className="stack quota-form" action={grantRoles}>
        <fieldset>
          <legend>
            <h2>{t("admin.administrators.grantTitle")}</h2>
          </legend>
          <div className="stack">
            <label htmlFor="grant-email">{t("admin.administrators.grantEmail")}</label>
            <input id="grant-email" className="input" name="email" type="email" required autoComplete="off" aria-describedby="grant-email-help" />
            <p id="grant-email-help">{t("admin.administrators.grantEmailHelp")}</p>
          </div>
          <fieldset className="stack">
            <legend>{t("admin.administrators.grantRoles")}</legend>
            {BACK_OFFICE_ROLES.map((role) => (
              <div key={role} className="checkbox-field">
                <input id={`grant-${role}`} type="checkbox" name="roles" value={role} aria-describedby={`grant-${role}-help`} />
                <label htmlFor={`grant-${role}`}>{roleName(role)}</label>
                <p id={`grant-${role}-help`}>{t(`admin.administrators.roleHelp.${role}`)}</p>
              </div>
            ))}
          </fieldset>
          <button className="button button-primary" type="submit">
            {t("admin.administrators.grant")}
          </button>
        </fieldset>
      </form>
    </BackOfficeLayout>
  );
}
