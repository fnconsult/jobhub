import type { BackOfficeAccess } from "@/admin/access";
import { activityTabs, type ActivityTabId } from "@/admin/activity";
import { TabLinks } from "@/design/TabLinks";
import { getServerT } from "@/i18n/server";

/** Activité's tabs the Administrator reads (#404), `shown` marked: the Design System's tabs, each a page (#465). */
export async function ActivityTabs({ access, shown }: { access: BackOfficeAccess; shown: ActivityTabId }) {
  const t = await getServerT();
  return <TabLinks label={t("admin.activity.tabsLabel")} tabs={activityTabs(access).map((tab) => ({ id: tab.id, href: tab.href, label: t(`admin.activity.tabs.${tab.id}`) }))} shown={shown} />;
}
