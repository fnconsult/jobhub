import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { getServerT } from "@/i18n/server";
import { extensionStorePage } from "@/platform-settings/extension-store";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

/**
 * Mon compte's Tools Section: the browser extension, installed from the Chrome Web Store
 * (EXTENSION_STORE_URL, a Platform Setting set on Paramètres, in use within seconds, #303);
 * until it is published there, a word that it is coming.
 */
/** The Section's title's id, which names its Card. */
const TOOLS_TITLE_ID = "tools-title";

export default async function AccountToolsPage() {
  const t = await getServerT();
  const storeUrl = extensionStorePage(getPlatformSettingsResolver().current());
  return (
    <Card title={t("account.tools.title")} headingId={TOOLS_TITLE_ID}>
      <section className="stack" aria-labelledby="extension-title">
        <h3 id="extension-title">{t("account.tools.extensionTitle")}</h3>
        <p>{t("account.tools.extensionIntro")}</p>
        {storeUrl ? (
          <div className="actions">
            <a className={buttonClass({ variant: "primary" })} href={storeUrl} rel="noopener noreferrer" target="_blank">
              {t("account.tools.install")}
            </a>
          </div>
        ) : (
          <Note>{t("account.tools.soon")}</Note>
        )}
      </section>
    </Card>
  );
}
