import { getServerT } from "@/i18n/server";
import { extensionStorePage } from "@/platform-settings/extension-store";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

/**
 * Mon compte's Tools Section: the browser extension, installed from the Chrome Web Store
 * (EXTENSION_STORE_URL, a Platform Setting set on Paramètres, in use within seconds, #303);
 * until it is published there, a word that it is coming.
 */
export default async function AccountToolsPage() {
  const t = await getServerT();
  const storeUrl = extensionStorePage(getPlatformSettingsResolver().current());
  return (
    <section className="stack" aria-labelledby="tools-title">
      <h2 id="tools-title">{t("account.tools.title")}</h2>
      <section className="stack" aria-labelledby="extension-title">
        <h3 id="extension-title">{t("account.tools.extensionTitle")}</h3>
        <p>{t("account.tools.extensionIntro")}</p>
        {storeUrl ? (
          <a className="button button-primary" href={storeUrl} rel="noopener noreferrer" target="_blank">
            {t("account.tools.install")}
          </a>
        ) : (
          <p className="notice">{t("account.tools.soon")}</p>
        )}
      </section>
    </section>
  );
}
