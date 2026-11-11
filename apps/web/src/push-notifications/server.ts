import {getCoachingNotifications} from "@/coaching-notifications/server";
import { sharedPool } from "@/database/pool";
import { getJobQueue } from "@/job-queue/server";
import { createPushNotifications, type PushNotifications } from "./index";

let instance: PushNotifications | undefined;

/**
 * The app's Push notifications, on the database named by DATABASE_URL, from the web app's side: the app registers and
 * forgets its devices, Rappels switches the events, and `notify` queues a notification for the worker (apps/worker),
 * which alone holds APNs' and FCM's keys and sends it.
 */
export function getPushNotifications(): PushNotifications {
  instance ??= createPushNotifications(sharedPool(), { eligibleNotification:(id,notice)=>getCoachingNotifications().pushStillCurrent(id,notice),senders: () => ({}), queue: getJobQueue() });
  return instance;
}
