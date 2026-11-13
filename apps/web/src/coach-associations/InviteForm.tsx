import { getServerT } from "@/i18n/server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { invite, cancelInvitation } from "./actions";
import type { Invitation } from "./index";
const F = { associationId: "associationId", role: "role", name: "name", email: "email", invitationId: "invitationId" };
export async function InviteForm({ associationId, role }: { associationId: string; role: "coach" | "manager" }) {
  const t = await getServerT();
  return (
    <form action={invite}>
      <Card title={t(role === "coach" ? "association.inviteCoach" : "association.inviteMember")}>
        <div className="stack">
          <input type="hidden" name={F.associationId} value={associationId} />
          <input type="hidden" name={F.role} value={role} />
          <Field label={t("association.name")}>
            <TextInput name={F.name} required minLength={2} maxLength={160} />
          </Field>
          <Field label={t("association.emailAddress")}>
            <TextInput name={F.email} type="email" required />
          </Field>
          <button className={buttonClass({ variant: "primary" })} type="submit">
            {t("association.invite")}
          </button>
        </div>
      </Card>
    </form>
  );
}
export async function PendingInvitations({ associationId, invitations }: { associationId: string; invitations: Invitation[] }) {
  const t = await getServerT();
  if (!invitations.length) return null;
  return (
    <Card title={t("association.pendingInvitations")}>
      {invitations.map((i) => (
        <article className="stack" key={i.id}>
          <p>
            {i.name} · {i.email}
          </p>
          <form action={cancelInvitation}>
            <input type="hidden" name={F.associationId} value={associationId} />
            <input type="hidden" name={F.invitationId} value={i.id} />
            <input type="hidden" name={F.role} value={i.role} />
            <button className={buttonClass({ variant: "danger" })} type="submit">
              {t("association.cancelInvitation")}
            </button>
          </form>
        </article>
      ))}
    </Card>
  );
}
