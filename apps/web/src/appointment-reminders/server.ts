import { getAuth, getMailer } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { createAppointmentReminders, type AppointmentReminders } from "./index";

let instance: AppointmentReminders | undefined;

/**
 * The app's Appointment Reminders, on the database named by DATABASE_URL. The web app
 * switches them on and off (Mon compte, Rappels); the worker (apps/worker) emails them.
 */
export function getAppointmentReminders(): AppointmentReminders {
  instance ??= createAppointmentReminders(sharedPool(), { mailer: getMailer(), baseURL: String(getAuth().options.baseURL) });
  return instance;
}
