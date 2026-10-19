"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";

/** Signs the person out and takes them home. In the Sidebar's foot, on every page of the sidebar layout. */
export function SignOutButton() {
  const { t } = useTranslation();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push(routes.home);
    router.refresh();
  }

  return (
    <button className="button button-quiet sidebar-sign-out" type="button" onClick={() => void signOut()}>
      <Icons.signOut />
      {t("account.signOut")}
    </button>
  );
}
