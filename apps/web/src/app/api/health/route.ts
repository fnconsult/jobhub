import { currentRelease } from "@/release";

/** The deploy's smoke test and the containers' health check (#559): ok, and the Version, commit and environment served. */
export function GET() {
  const { version, commit, environment } = currentRelease();
  return Response.json({ status: "ok", version, commit, environment });
}
