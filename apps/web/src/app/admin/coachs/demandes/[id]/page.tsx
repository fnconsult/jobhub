import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { DocumentViewer } from "@/design/DocumentViewer";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { getServerT } from "@/i18n/server";
export const metadata = { robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { access } = await requireBackOffice("humanCoaches");
  if (!coachSpaceV2On()) notFound();
  const { id } = await params;
  const proof = await getCoachEnrolments().proofInfo(id);
  if (!proof) notFound();
  const t = await getServerT();
  return (
    <BackOfficeLayout access={access} title={t("coachEnrolment.adminProof")}>
      <DocumentViewer src={`/api/admin/coach-enrolments/${id}/proof`} fileName={proof.name} readOnly />
    </BackOfficeLayout>
  );
}
