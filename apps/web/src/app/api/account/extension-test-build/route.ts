import { NextResponse } from "next/server";
import { currentIsAdministrator } from "@/admin/server";
import { extensionTestBuild } from "@/extension-version";
import { readExtensionZip } from "@/extension-version/server";
import { currentRelease } from "@/release";

/**
 * The zip of the Extension Version this deployment carries, the one tied to its environment (the beta zip on the Beta,
 * the public one in Production), for an Administrator to load unpacked from Outils before the store review (#920, #989).
 * Only the people Outils shows it to, with no GitHub access needed: apps/web/Dockerfile builds it into the image.
 * 200 zip · 404 (not an Administrator, or no zip on this server)
 */
export async function GET() {
  if (!(await currentIsAdministrator())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { zip } = extensionTestBuild(currentRelease());
  const bytes = await readExtensionZip(zip);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${zip}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
    },
  });
}
