import { createI18n } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
import type { Invitation } from "./index";
export function associationInvitationEmail(record: Invitation, token: string, baseURL: string) {
  const { t } = createI18n(record.locale);
  const url = new URL(`/espace-association/invitations/${record.id}`, baseURL);
  url.searchParams.set("token", token);
  url.searchParams.set("lang", record.locale);
  return renderEmail({
    language: record.locale,
    subject: t("association.email.subject", { name: record.associationName }),
    title: t("association.email.subject", { name: record.associationName }),
    body: [
      t(record.role === "coach" ? "association.email.coach" : "association.email.manager", { name: record.associationName }),
      t("association.email.expiry"),
      { action: { label: t("association.email.open"), url: url.toString() } },
    ],
    footer: { reason: t("association.email.footer") },
  });
}
