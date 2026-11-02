import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerT } from "@/i18n/server";
import { loadProfilePage } from "./profile-page";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await loadProfilePage((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/**
 * A Profile's Sections (ADR-0024), each at its own address: the page is the Profile's conversation (../layout.tsx,
 * #605, ADR-0070), each Section opening in the Work Pane beside it.
 */
export default function ProfileSectionsLayout({ children }: { children: ReactNode }) {
  return children;
}
