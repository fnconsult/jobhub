import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { CvOnboarding } from "@/components/CvOnboarding";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("cvUpload.title")} · ${t("app.name")}` };
}

/** Creating a Profile from an uploaded CV (no LinkedIn import of any kind, ADR-0001). */
export default async function NewProfilePage() {
  if (!(await getCurrentCandidate())) redirect(routes.signIn);
  const t = await getServerT();
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{t("cvUpload.title")}</h1>
      <p className="lead">{t("cvUpload.intro")}</p>
      <CvOnboarding />
    </main>
  );
}
