import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
import type { Queryable } from "../database/pool";
/** A retired coach's payout notice remains bound to its original account, never a recycled email address. */
export async function payoutRecipient(database: Queryable, sellerId: string) {
  return (
    (
      await database.query<{ email: string; locale: Locale; path: string }>(
        `SELECT c.email,coalesce(c."interfaceLanguage",'fr') AS locale,CASE WHEN s.kind='association' THEN '/espace-association/'||s.association_id||'/revenus' ELSE '/espace-coach/revenus' END AS path FROM coaching_seller s JOIN coaching_connect_account k ON k.seller_id=s.id JOIN candidate c ON c."emailVerified" AND ((s.kind='human_coach' AND c.id=k.owner_id) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_manager m JOIN coach_association a ON a.id=m.association_id AND a.retired_at IS NULL WHERE m.association_id=s.association_id AND m.candidate_id=c.id))) WHERE s.id=$1 ORDER BY c.id LIMIT 1`,
        [sellerId],
      )
    ).rows[0] ?? null
  );
}
export function payoutInformationEmail(recipient: { locale: Locale; path: string }, notice: { amount: number; currency: string }, baseURL: string) {
  const { t } = createI18n(recipient.locale),
    amount = new Intl.NumberFormat(recipient.locale, { style: "currency", currency: notice.currency }).format(notice.amount / 100);
  return renderEmail({
    language: recipient.locale,
    subject: t("coachConnect.email.subject"),
    title: t("coachConnect.email.subject"),
    body: [t("coachConnect.email.amount", { amount }), t("coachConnect.email.obligations"), "https://www.impots.gouv.fr/", "https://www.urssaf.fr/"],
    footer: { reason: t("coachConnect.email.footer"), link: { label: t("coachSpaceV2.pages.revenus"), url: new URL(recipient.path, baseURL).toString() } },
  });
}
