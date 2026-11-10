import { getServerT } from "@/i18n/server";
import { Field, TextInput } from "@/design/Field";
import { invite, cancelInvitation } from "./actions";
import type { Invitation } from "./index";
const F = { associationId: "associationId", role: "role", name: "name", email: "email", invitationId: "invitationId" };
export async function InviteForm({ associationId, role }: { associationId: string; role: "coach" | "manager" }) {
  const t = await getServerT();
  return (
    <form className="coach-space-card stack" action={invite}>
      <h2>{t(role === "coach" ? "association.inviteCoach" : "association.inviteMember")}</h2>
      <input type="hidden" name={F.associationId} value={associationId} />
      <input type="hidden" name={F.role} value={role} />
      <Field label={t("association.name")}>
        <TextInput name={F.name} required minLength={2} maxLength={160} />
      </Field>
      <Field label={t("association.emailAddress")}>
        <TextInput name={F.email} type="email" required />
      </Field>
      <button className="button" type="submit">
        {t("association.invite")}
      </button>
    </form>
  );
}
export async function PendingInvitations({ associationId, invitations }: { associationId: string; invitations: Invitation[] }) {
  const t = await getServerT();
  if (!invitations.length) return null;
  return (
    <section className="coach-space-card stack">
      <h2>{t("association.pendingInvitations")}</h2>
      {invitations.map((i) => (
        <article className="stack" key={i.id}>
          <p>
            {i.name} · {i.email}
          </p>
          <form action={cancelInvitation}>
            <input type="hidden" name={F.associationId} value={associationId} />
            <input type="hidden" name={F.invitationId} value={i.id} />
            <input type="hidden" name={F.role} value={i.role} />
            <button className="button" type="submit">
              {t("association.cancelInvitation")}
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
