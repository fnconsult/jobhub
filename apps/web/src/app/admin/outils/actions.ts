"use server";

/**
 * What a Tool's page in Outils sends (#698): the test notification of APNs or FCM, a super-admin's alone, to their own
 * devices of that platform, whatever their Rappels switches. It is queued for the worker, which holds the providers'
 * keys and sends it; the page says it was sent, and a failure shows on it with its Failure Reason.
 */
import { notFound, redirect } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { pushPlatformOfTool } from "@/push-notifications";
import { getPushNotifications } from "@/push-notifications/server";
import { routes } from "@/routes";

export async function sendTestPushNotification(form: FormData) {
  const { administrator, access } = await requireBackOffice("tools");
  if (!access.isSuperAdmin) notFound();
  const toolId = String(form.get("tool") ?? "");
  const platform = pushPlatformOfTool(toolId);
  if (!platform) notFound();
  await getPushNotifications().notify(administrator.id, { event: "test" }, { platform });
  redirect(`${routes.adminTool(toolId)}?test=envoyee#push-test`);
}
