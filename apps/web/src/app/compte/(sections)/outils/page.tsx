import { TEST_BUILD_EXTENSION_ID, TEST_BUILD_EXTENSION_ORIGIN } from "@jobhub/shared/extension-test-build";
import { currentIsAdministrator } from "@/admin/server";
import { ExternalLink } from "@/components/ExternalLink";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { extensionTestBuild } from "@/extension-version";
import { hasExtensionZip, recognisesTestBuild } from "@/extension-version/server";
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
 * API Version it serves, its zip tied to this environment, served by this server (#989: apps/web/Dockerfile builds it
 * into the image, so no GitHub access is needed), and how to load it unpacked in Chrome. A server with no zip
 * (outside an image) says so. The zip's id is fixed (@jobhub/shared/extension-test-build): the Section says whether this
 * server's EXTENSION_ORIGINS lists it, without which the extension loaded reads the session but every Capture is refused.
 */
async function ExtensionTestBuildSection({ t }: { t: Awaited<ReturnType<typeof getServerT>> }) {
  const build = extensionTestBuild(currentRelease());
  const available = await hasExtensionZip(build.zip);
  return (
    <section className="stack" aria-labelledby="extension-test-build-title">
      <h3 id="extension-test-build-title">{t("account.tools.testBuild.title")}</h3>
      <p>{t("account.tools.testBuild.intro")}</p>
      <Properties>
        <Property term={t("account.tools.testBuild.extensionVersion")}>{build.extensionVersion}</Property>
        <Property term={t("account.tools.testBuild.apiVersion")}>{build.apiVersion}</Property>
        <Property term={t("account.tools.testBuild.extensionId")}>
          <code>{TEST_BUILD_EXTENSION_ID}</code>
        </Property>
      </Properties>
      {recognisesTestBuild() ? (
        <Note tone="success">{t("account.tools.testBuild.recognised")}</Note>
      ) : (
        <Note tone="warn" title={t("account.tools.testBuild.notRecognisedTitle")}>
          {t("account.tools.testBuild.notRecognised", { origin: TEST_BUILD_EXTENSION_ORIGIN })}
        </Note>
      )}
      {available ? (
        <div className="actions">
          <a className={buttonClass({ variant: "secondary" })} href={build.downloadUrl} download={build.zip}>
            {t("account.tools.testBuild.download", { zip: build.zip })}
          </a>
        </div>
      ) : (
        <Note>{t("account.tools.testBuild.unavailable", { zip: build.zip })}</Note>
      )}
      <ol aria-label={t("account.tools.testBuild.stepsLabel")}>
        <li>{t("account.tools.testBuild.steps.download", { zip: build.zip })}</li>
        <li>{t("account.tools.testBuild.steps.developerMode")}</li>
        <li>{t("account.tools.testBuild.steps.loadUnpacked")}</li>
      </ol>
    </section>
  );
}
