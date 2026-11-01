import type { PrivacyPolicyCoverage } from "@jobhub/help";
import type { Tool } from "@jobhub/shared";
import { Note } from "@/design/Note";
import type { getServerT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * The warning of a recipient outside the EU switched on that the privacy policy in effect does not name (#548, ADR-0064):
 * on Paramètres once the change that switched it on is saved, and on its Outils page, read-only, while it stays so. It
 * says which version of the policy is in effect; switching it on was not blocked.
 */
export function UncoveredRecipientNote({ t, locale, tool, policy }: { t: T; locale: string; tool: Tool; policy: PrivacyPolicyCoverage }) {
  const version = policy.version ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${policy.version}T00:00:00Z`)) : null;
  return (
    <Note tone="warn" role="alert" title={t("admin.tools.uncoveredRecipient.title", { name: tool.name })} data-uncovered-recipient={tool.id}>
      <p>{t("admin.tools.uncoveredRecipient.warning")}</p>
      <p>{version ? t("admin.tools.uncoveredRecipient.policyInEffect", { version }) : t("admin.tools.uncoveredRecipient.noPolicy")}</p>
    </Note>
  );
}
