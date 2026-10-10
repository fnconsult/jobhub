import { applicationExportResponse } from "@/application-exports/http";

type Context = RouteContext<"/api/applications/[id]/cover-letter/export">;

/**
 * Downloads the Application's Cover Letter, in its Document Language.
 * Query: format=pdf|docx, template=<CV Template>.
 * 200 file · 400 { error: "invalid_format" | "invalid_template" } · 401 · 404 (also when there is no Cover Letter yet)
 */
export async function GET(request: Request, { params }: Context) {
  return applicationExportResponse(request, (await params).id, "cover_letter");
}
