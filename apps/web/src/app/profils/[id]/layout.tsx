import type { ReactNode } from "react";
import { ProfileConversation } from "./conversation";

type Params = { params: Promise<{ id: string }> };

/**
 * Every page of a Profile (#605, ADR-0070): the Profile's conversation and its Fiche, around what the address opens in
 * the Work Pane (a Section, the Master CV's editor, its versions or one of them), which keeps the conversation as it is
 * from one to the other.
 */
export default async function ProfileLayout({ params, children }: Params & { children: ReactNode }) {
  return <ProfileConversation id={(await params).id}>{children}</ProfileConversation>;
}
