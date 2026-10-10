import { applicationExportResponse } from "@/application-exports/http";

type Context = RouteContext<"/api/applications/[id]/tailored-cv/export">;

/**
 * Downloads the Application's saved Tailored CV, in its Document Language.
 * Query: format=pdf|docx, template=<CV Template>.
 * 200 file · 400 { error: "invalid_format" | "invalid_template" } · 401 · 404 (also when no Tailored CV is saved)
 */
export async function GET(request: Request, { params }: Context) {
  return applicationExportResponse(request, (await params).id, "tailored_cv");
}
