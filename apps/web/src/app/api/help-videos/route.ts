import { publishedDurations } from "@/help-media";
import { motionManifest } from "@/help-media/server";

/**
 * The Explainer Videos published in `?locale=` (fr, the default, or en), as their scripts' durations in seconds (#568):
 * what the Coach Panel's card of a Tutorial needs to say « Voir la vidéo (durée) ». Read from the bucket's manifest by
 * the server, so the Coach Panel asks nothing of the bucket; public, like the Help Centre.
 */
export async function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "fr";
  return Response.json({ durations: publishedDurations(await motionManifest(), locale) }, { headers: { "Cache-Control": "public, max-age=60" } });
}
