import { API_VERSION } from "@jobhub/shared";
import { currentRelease } from "@/release";

/**
 * The deploy's smoke test and the containers' health check (#559): ok, and the Version, commit and environment served;
 * and the API Version the extension is served in (#564), with the one before.
 */
export function GET() {
  const { version, commit, environment } = currentRelease();
  return Response.json({ status: "ok", version, commit, environment, apiVersion: API_VERSION });
}
