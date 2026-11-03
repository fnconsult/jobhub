"use client";

import { usePathname } from "next/navigation";
import type { AnchorHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { exitHref, isExternalHref } from "@/external-links";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "rel" | "target"> & {
  href: string;
  /** Opens the Exit Page in a new tab (the default), or in this one. */
  newTab?: boolean;
};

/**
 * A link to a site outside Jobbbox: it leads to the Exit Page, in the shell of the page it is on, which tells the
 * person they are leaving Jobbbox before taking them there. A link that stays in Jobbbox is drawn as given. Its
 * `rel` keeps the referrer, a page of Jobbbox, which lets the Exit Page go on by itself (see exitRedirectsBySelf);
 * the Exit Page does not pass it on.
 */
export function ExternalLink({ href, newTab = true, children, ...rest }: Props) {
  const pathname = usePathname();
  const { i18n } = useTranslation();
  if (!isExternalHref(href)) {
    return (
      <a {...rest} href={href}>
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={exitHref(href, pathname ?? "/", i18n.language)} rel="noopener nofollow" target={newTab ? "_blank" : undefined}>
      {children}
    </a>
  );
}
