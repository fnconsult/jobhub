import type { ReactNode } from "react";
import { AccountLayout, accountMetadata } from "../account-layout";

export const generateMetadata = accountMetadata;

/** Mon compte's Sections open while a CGU version waits for the Candidate's Acceptance: Mes données (see account-layout). */
export default function AccountOpenSectionsLayout({ children }: { children: ReactNode }) {
  return <AccountLayout>{children}</AccountLayout>;
}
