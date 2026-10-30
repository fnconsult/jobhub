import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { AccountSections } from "@/components/AccountSections";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "./account.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("account.title")} · ${t("app.name")}` };
}

/** Mon compte, split into its Sections (ADR-0024): each a page of its own under /compte. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  return (
    <AccountSections candidateId={candidate.id}>
      <div className="account-section">{children}</div>
    </AccountSections>
  );
}
