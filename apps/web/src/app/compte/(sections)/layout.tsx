import type { ReactNode } from "react";
import { AccountLayout, accountMetadata } from "../account-layout";

export const generateMetadata = accountMetadata;

/** Mon compte's Sections closed while a CGU version waits for the Candidate's Acceptance (see account-layout). */
export default function AccountSectionsLayout({ children }: { children: ReactNode }) {
  return <AccountLayout>{children}</AccountLayout>;
}
