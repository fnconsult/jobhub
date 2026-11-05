import type { Tool } from "@jobhub/shared";
import { Button } from "@/design/Button";
import { Note } from "@/design/Note";
import { Table } from "@/design/Table";
import type { getServerT } from "@/i18n/server";
import type { PushPlatform } from "@/push-notifications";
import { getPushNotifications } from "@/push-notifications/server";
import { sendTestPushNotification } from "./actions";

type T = Awaited<ReturnType<typeof getServerT>>;

/** The most failures shown: the newest. */
const FAILURES_SHOWN = 50;

/**
 * On APNs' and FCM's pages in Outils (#698): the notifications the Tool did not deliver, newest first, with their event,
 * Failure Reason (ADR-0030) and HTTP status, never a token, an account nor a text; and, for a super-admin, the test
 * notification to their own devices of the platform, with how many they have.
 */
export async function PushNotificationsSection({ t, locale, tool, platform, administratorId, isSuperAdmin, testSent }: { t: T; locale: string; tool: Tool; platform: PushPlatform; administratorId: string; isSuperAdmin: boolean; testSent: boolean }) {
  const push = getPushNotifications();
  const [failures, devices] = await Promise.all([push.failures({ platform, limit: FAILURES_SHOWN }), isSuperAdmin ? push.devices(administratorId) : Promise.resolve([])]);
  const own = devices.filter((device) => device.platform === platform).length;
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });
  const platformName = t(`admin.tools.push.platforms.${platform}`);

  return (
    <section className="section-block" aria-labelledby="push-failures">
      <h2 id="push-failures">{t("admin.tools.push.title")}</h2>
      <p>{t("admin.tools.push.intro", { name: tool.name })}</p>
      {failures.length === 0 ? (
        <p>{t("admin.tools.push.noFailures")}</p>
      ) : (
        <Table
          label={t("admin.tools.push.failuresCaption", { name: tool.name })}
          columns={[
            { header: t("admin.tools.at"), cell: (failure) => <time dateTime={failure.at.toISOString()}>{at.format(failure.at)}</time> },
            { header: t("admin.tools.push.event"), cell: (failure) => t(`pushNotifications.messages.${failure.event}.title`) },
            { header: t("admin.tools.reason"), cell: (failure) => t(`failureReasons.${failure.reason}`) },
            { header: t("admin.tools.outcome"), cell: (failure) => (failure.httpStatus === null ? t("admin.tools.noAnswer") : t("admin.tools.httpStatus", { status: failure.httpStatus })) },
          ]}
          rows={failures.map((failure, index) => ({ ...failure, index }))}
          rowKey={(failure) => `${failure.at.toISOString()}-${failure.index}`}
        />
      )}

      <h3 id="push-test">{t("admin.tools.push.testTitle")}</h3>
      {isSuperAdmin ? (
        <form action={sendTestPushNotification} className="stack">
          <input type="hidden" name="tool" value={tool.id} />
          <p>{t("admin.tools.push.testIntro", { platform: platformName })}</p>
          <p className="section-meta">{t("admin.tools.push.testDevices", { count: own, platform: platformName })}</p>
          {testSent ? (
            <Note tone="success" role="status">
              {t("admin.tools.push.testQueued")}
            </Note>
          ) : null}
          <p>
            <Button type="submit" disabled={own === 0}>
              {t("admin.tools.push.testSend")}
            </Button>
          </p>
        </form>
      ) : (
        <p>{t("admin.tools.push.testSuperAdminOnly")}</p>
      )}
    </section>
  );
}
