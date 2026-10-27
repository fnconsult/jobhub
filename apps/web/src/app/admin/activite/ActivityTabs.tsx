import Link from "next/link";
import type { BackOfficeAccess } from "@/admin/access";
import { activityTabs, type ActivityTabId } from "@/admin/activity";
import { getServerT } from "@/i18n/server";

/** How the tabs' links say which one is shown (`.tab` styles, ADR-0018), and to assistive technologies. */
const TAB_STATE = { shown: "active", hidden: "inactive" } as const;
const CURRENT = "page";

/** Activité's tabs the Administrator reads (#404), `shown` marked. */
export async function ActivityTabs({ access, shown }: { access: BackOfficeAccess; shown: ActivityTabId }) {
  const t = await getServerT();
  return (
    <nav aria-label={t("admin.activity.tabsLabel")}>
      <ul className="tablist">
        {activityTabs(access).map((tab) => (
          <li key={tab.id}>
            <Link prefetch={false} className="tab" href={tab.href} data-state={tab.id === shown ? TAB_STATE.shown : TAB_STATE.hidden} aria-current={tab.id === shown ? CURRENT : undefined}>
              {t(`admin.activity.tabs.${tab.id}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
