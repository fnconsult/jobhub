import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { AccountSettings } from "@/components/AccountSettings";
import { TextSizeSlider } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** Mon compte's Preferences Section: the Interface Language and the Text Size. */
export default async function AccountPreferencesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  return (
    <section className="stack" aria-labelledby="preferences-title">
      <h2 id="preferences-title">{t("account.sections.preferences")}</h2>
      <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
      <TextSizeSlider />
    </section>
  );
}
