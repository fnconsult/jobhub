import type { ExternalApiLog } from "@jobhub/shared";
import { sharedPool } from "@/database/pool";
import { createPostgresExternalApiLog } from "./index";

let externalApis: ExternalApiLog | undefined;

/**
 * Where the app's calls to external APIs (contact enrichment, Stripe, mail, sign-in...) are
 * recorded; none without a database. Apart from ai-usage/server.ts, which reads the Back Office:
 * the sign-in and mail modules the Back Office reads the session through record here too.
 */
export function getExternalApiLog(): ExternalApiLog {
  externalApis ??= process.env.DATABASE_URL ? createPostgresExternalApiLog(sharedPool()) : { record: () => {} };
  return externalApis;
}
