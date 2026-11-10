import { sharedPool } from "@/database/pool";
import { createExtensionEvents, extensionCallFrom, type ExtensionCall, type ExtensionEvents } from "./index";

let instance: ExtensionEvents | undefined;

/** The app's Extension Events (#924), on the database named by DATABASE_URL: what POST /api/extension/events records. */
export function getExtensionEvents(): ExtensionEvents {
  instance ??= createExtensionEvents(sharedPool());
  return instance;
}

/**
 * The extension's call, when `request` comes from it (its Surface, #919), made by `candidateId` (null: a Guest), with
 * the Extension Version it states; null for the web app, the Jobbbox app or anything else, which record no Extension Event.
 */
export async function extensionCallOf(request: Request, candidateId: string | null): Promise<ExtensionCall | null> {
  // Imported here: the sign-in module is heavy, and the web app's origin is only needed for a call to read.
  const { getAuth } = await import("@/auth/server");
  return extensionCallFrom(request.headers, candidateId, new URL(String(getAuth().options.baseURL)).origin);
}
