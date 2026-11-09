import { currentIsAdministrator } from "@/admin/server";
import { ExternalLink } from "@/components/ExternalLink";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { extensionTestBuild } from "@/extension-version";
import { getServerT } from "@/i18n/server";
import { extensionStorePage } from "@/platform-settings/extension-store";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { currentRelease } from "@/release";

/**
 * Mon compte's Tools Section: the browser extension, installed from the Chrome Web Store
 * (EXTENSION_STORE_URL, a Platform Setting set on Paramètres, in use within seconds, #303);
 * until it is published there, a word that it is coming. Under it, for Administrators only (#920), the latest
 * extension to load unpacked before the store review: see ExtensionTestBuildSection.
 */
/** The Section's title's id, which names its Card. */
const TOOLS_TITLE_ID = "tools-title";

export default async function AccountToolsPage() {
  const [t, isAdministrator] = await Promise.all([getServerT(), currentIsAdministrator()]);
  const storeUrl = extensionStorePage(getPlatformSettingsResolver().current());
  return (
    <Card title={t("account.tools.title")} headingId={TOOLS_TITLE_ID}>
      <section className="stack" aria-labelledby="extension-title">
        <h3 id="extension-title">{t("account.tools.extensionTitle")}</h3>
        <p>{t("account.tools.extensionIntro")}</p>
        {storeUrl ? (
          <div className="actions">
            <ExternalLink className={buttonClass({ variant: "primary" })} href={storeUrl}>
              {t("account.tools.install")}
            </ExternalLink>
          </div>
        ) : (
          <Note>{t("account.tools.soon")}</Note>
        )}
      </section>
      {isAdministrator ? <ExtensionTestBuildSection t={t} /> : null}
    </Card>
  );
}

/**
 * « Dernière version de l'extension » (#920, decided in #913): the Extension Version this deployment carries and the
 * API Version it serves, how to load this environment's zip unpacked in Chrome, and the repo's Releases where
 * extension.yml attaches the zips (private: no GitHub token on the server).
 */
function ExtensionTestBuildSection({ t }: { t: Awaited<ReturnType<typeof getServerT>> }) {
  const build = extensionTestBuild(currentRelease());
  return (
    <section className="stack" aria-labelledby="extension-test-build-title">
      <h3 id="extension-test-build-title">{t("account.tools.testBuild.title")}</h3>
      <p>{t("account.tools.testBuild.intro")}</p>
      <Properties>
        <Property term={t("account.tools.testBuild.extensionVersion")}>{build.extensionVersion}</Property>
        <Property term={t("account.tools.testBuild.apiVersion")}>{build.apiVersion}</Property>
      </Properties>
      <ol aria-label={t("account.tools.testBuild.stepsLabel")}>
        <li>{t("account.tools.testBuild.steps.download", { zip: build.zip })}</li>
        <li>{t("account.tools.testBuild.steps.developerMode")}</li>
        <li>{t("account.tools.testBuild.steps.loadUnpacked")}</li>
      </ol>
      <p>
        <ExternalLink href={build.releasesUrl}>
          {t("account.tools.testBuild.releases")}
          <span className="visually-hidden"> {t("account.tools.newTab")}</span>
        </ExternalLink>{" "}
        {t("account.tools.testBuild.access")}
      </p>
    </section>
  );
}
