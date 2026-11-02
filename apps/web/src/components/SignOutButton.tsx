"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";

/** Signs the person out and takes them home: the Sidebar's « Se déconnecter », a button or Mon compte's menu item. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    await authClient.signOut();
    router.push(routes.home);
    router.refresh();
  };
}

/** « Se déconnecter » in the Sidebar's foot, on every page of the sidebar layout but the Candidate's (Mon compte's menu). */
export function SignOutButton() {
  const { t } = useTranslation();
  const signOut = useSignOut();

  return (
    <button className="button button-quiet sidebar-sign-out" type="button" onClick={() => void signOut()}>
      <Icons.signOut />
      {t("account.signOut")}
    </button>
  );
}
